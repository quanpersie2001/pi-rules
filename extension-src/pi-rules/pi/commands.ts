import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type PiRulesMode, writeProjectConfigPatch } from "../app/config.js";
import type { InjectionRecord, RuleStatus } from "../domain/types.js";
import type { Recommendation } from "../features/recommendation-types.js";
import { runDoctor } from "./doctor.js";
import type { RuntimeDeps } from "./runtime.js";

/**
 * Runtime surface required by the slash commands. `getRuntime` returns the
 * current runtime, which may be swapped when `syncRuntime` rebuilds it. The
 * two helper methods are passed through to keep the commands in sync with
 * event handlers.
 */
export interface CommandRuntime {
	getRuntime(): RuntimeDeps;
	syncRuntime(cwd: string): void;
	updateWidget(ctx: ExtensionContext): Promise<void>;
}

/**
 * Register all pi-rules slash commands on the given extension API.
 */
export function registerCommands(pi: ExtensionAPI, runtime: CommandRuntime): void {
	pi.registerCommand("pi-rules:init", {
		description: "Invoke the init-advanced skill with optional prompt",
		handler: async (args, ctx) => {
			const extra = args.trim();
			const message = extra ? `/skill:init-advanced ${extra}` : "/skill:init-advanced";
			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
			} else {
				pi.sendUserMessage(message, { deliverAs: "followUp" });
			}
		},
	});

	pi.registerCommand("pi-rules:status", {
		description: "Show discovered rules and pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			await current.store.initialize();
			const status = await current.engine.getStatus(ctx.cwd);
			const recs = await current.store.getPending();
			ctx.ui.notify(formatStatus(status, recs.length), "info");
			if (recs.length === 0) {
				return;
			}

			const choice = await ctx.ui.select(
				"Select a rule update recommendation:",
				recs.map((rec, idx) => `${idx + 1}. [${rec.id}] ${rec.ruleRelativePath} — ${rec.summary.split("\n")[0]}`),
			);
			if (!choice) return;

			const match = choice.match(/^\d+\. \[([^\]]+)\]/);
			const id = match?.[1];
			if (!id) return;
			const rec = recs.find((item) => item.id === id);
			if (!rec) return;

			const ruleContent = await readFile(rec.rulePath, "utf8").catch(() => undefined);
			await ctx.ui.editor("Rule update preview", formatRecommendationDialog(rec, ruleContent));

			const action = await ctx.ui.select("Action:", [
				"Approve (apply this recommendation)",
				"Cancel (dismiss)",
				"Close",
			]);
			if (action?.startsWith("Approve")) {
				await applyRecommendation(current, rec, ctx);
			} else if (action?.startsWith("Cancel")) {
				await current.store.cancel(rec.id);
				ctx.ui.notify(`Cancelled ${rec.id}`, "info");
				await runtime.updateWidget(ctx);
			}
		},
	});

	pi.registerCommand("pi-rules:mode", {
		description: "Set project pi-rules injection mode",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const currentMode = runtime.getRuntime().config.mode;
			const requested = args.trim();
			const selected = isMode(requested) ? requested : await ctx.ui.select("pi-rules mode", modeOptions(currentMode));
			const mode = parseModeSelection(selected);
			if (mode === undefined) return;

			const configPath = writeProjectConfigPatch(runtime.getRuntime().state.projectRoot, { mode });
			runtime.syncRuntime(ctx.cwd);
			await runtime.updateWidget(ctx);
			ctx.ui.notify(`pi-rules mode set to ${mode} in ${configPath}`, "info");
		},
	});

	pi.registerCommand("pi-rules:write-guard", {
		description: "Configure project pi-rules write/edit guard",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const requested = args.trim().toLowerCase();
			const selected =
				parseWriteGuardArg(requested) ??
				(await ctx.ui.select("pi-rules write guard", guardOptions(current.config.writeGuardEnabled)));
			const writeGuardEnabled = parseWriteGuardSelection(selected);
			if (writeGuardEnabled === undefined) return;

			const configPath = writeProjectConfigPatch(current.state.projectRoot, { writeGuardEnabled });
			runtime.syncRuntime(ctx.cwd);
			await runtime.updateWidget(ctx);
			ctx.ui.notify(`pi-rules write guard ${writeGuardEnabled ? "enabled" : "disabled"} in ${configPath}`, "info");
		},
	});

	pi.registerCommand("pi-rules:doctor", {
		description: "Show rule discovery report with diagnostics",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const result = await runDoctor(ctx.cwd, current);
			ctx.ui.notify(result.lines.join("\n"), "info");
		},
	});

	pi.registerCommand("pi-rules:context", {
		description: "Show last injected pi-rules context",
		handler: async (_args, ctx) => {
			const current = runtime.getRuntime();
			ctx.ui.notify(formatContext(current.state.lastContext), "info");
		},
	});

	pi.registerCommand("pi-rules:cleanup", {
		description: "Show recommendation storage location",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			ctx.ui.notify(`Recommendations are stored at ${current.store.recommendationsPath}`, "info");
		},
	});
}

const MODES: readonly PiRulesMode[] = ["static", "dynamic", "both", "off"];

function isMode(value: unknown): value is PiRulesMode {
	return typeof value === "string" && MODES.includes(value as PiRulesMode);
}

function modeOptions(currentMode: PiRulesMode): string[] {
	return MODES.map((mode) => (mode === currentMode ? `${mode} (current)` : mode));
}

function parseModeSelection(selection: string | undefined): PiRulesMode | undefined {
	const value = selection?.replace(" (current)", "").trim();
	return isMode(value) ? value : undefined;
}

function guardOptions(enabled: boolean): string[] {
	return enabled ? ["Disable write guard", "Keep enabled"] : ["Enable write guard", "Keep disabled"];
}

function parseWriteGuardArg(value: string): string | undefined {
	if (["on", "true", "1", "enable", "enabled"].includes(value)) return "Enable write guard";
	if (["off", "false", "0", "disable", "disabled"].includes(value)) return "Disable write guard";
	return undefined;
}

function parseWriteGuardSelection(selection: string | undefined): boolean | undefined {
	if (selection?.startsWith("Enable") || selection?.startsWith("Keep enabled")) return true;
	if (selection?.startsWith("Disable") || selection?.startsWith("Keep disabled")) return false;
	return undefined;
}

async function applyRecommendation(
	current: RuntimeDeps,
	rec: Recommendation,
	ctx: ExtensionContext,
	notifySuccess = true,
): Promise<boolean> {
	await current.store.approve(rec.id);
	try {
		await spawnUpdateAgent(rec, current.state.projectRoot);
		await current.store.markCompleted(rec.id);
		if (notifySuccess) {
			ctx.ui.notify(`Applied recommendation ${rec.id}: Updated ${rec.ruleRelativePath}`, "info");
		}
		return true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await current.store.markError(rec.id, errorMessage);
		ctx.ui.notify(`Failed to apply ${rec.id}: ${errorMessage}`, "error");
		return false;
	}
}

export function formatStatus(status: RuleStatus, pendingCount?: number): string {
	const lines = [
		`Project root: ${status.projectRoot}`,
		`Rules dir: ${status.rulesDir}`,
		`Rules: ${status.ruleCount} files`,
		`Diagnostics: ${status.diagnostics.length}`,
	];
	if (pendingCount !== undefined && pendingCount > 0) {
		lines.push(`Pending Recommendations: ${pendingCount}`);
	}
	for (const rule of status.rules) {
		const scope = Array.isArray(rule.frontmatter.paths)
			? rule.frontmatter.paths.join(", ")
			: (rule.frontmatter.paths ?? (rule.frontmatter.alwaysApply ? "alwaysApply" : "none"));
		lines.push(
			`- ${rule.relativePath} :: ${scope}${rule.frontmatter.summary ? ` :: ${rule.frontmatter.summary}` : ""}`,
		);
	}
	for (const diagnostic of status.diagnostics) {
		lines.push(`! ${diagnostic.rulePath ?? "unknown"}: ${diagnostic.message}`);
	}
	return lines.join("\n");
}

export function formatContext(lastContext: InjectionRecord | undefined): string {
	if (lastContext === undefined) {
		return "No pi-rules context has been injected yet.";
	}
	const lines = [
		`Turn: ${lastContext.turnId}`,
		`Targets: ${lastContext.targetPaths.join(", ") || "(none)"}`,
		`Rules: ${lastContext.rules.length}`,
		`Truncated: ${lastContext.truncated ? "yes" : "no"}`,
	];
	for (const rule of lastContext.rules) {
		lines.push(`- ${rule.relativePath} (${rule.matchReason.type})`);
	}
	return lines.join("\n");
}

/**
 * Quick summary preview: show the content to add and the reason.
 */
export function formatRecommendationDialog(
	rec: {
		id: string;
		ruleRelativePath: string;
		summary: string;
		content: string;
		reason: string;
	},
	ruleContent: string | undefined,
): string {
	const lines = [
		`# ${rec.summary}`,
		"",
		`**Recommendation:** ${rec.id}`,
		`**Rule file:** ${rec.ruleRelativePath}`,
		"",
		"## Proposed rule update",
		"",
		...rec.content.split("\n"),
		"",
		"## Why this is needed",
		"",
		...rec.reason.split("\n"),
	];

	if (ruleContent !== undefined) {
		const ruleLines = ruleContent.split("\n").slice(0, 12);
		lines.push("", "## Current rule excerpt", "", "```markdown", ...ruleLines);
		if (ruleContent.split("\n").length > 12) {
			lines.push("...");
		}
		lines.push("```");
	}

	lines.push("", "---", "After closing this preview, choose Approve / Cancel / Close.");
	return lines.join("\n");
}

/**
 * Spawn the rules-maintainer skill agent to apply a recommendation.
 */
async function spawnUpdateAgent(
	rec: Pick<Recommendation, "rulePath" | "content" | "reason">,
	projectRoot: string,
	timeoutMs = 5 * 60 * 1000,
): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		if (!projectRoot) {
			reject(new Error("Project root not available"));
			return;
		}
		const skillPath = resolve(projectRoot, "skills/rules-maintainer");

		const prompt = [
			`Update the rule file at ${rec.rulePath}`,
			`The following describes what should be reflected in the rule:`,
			rec.content,
			`Reason: ${rec.reason}`,
			`Read the current rule file and apply the changes described above.`,
			`Do NOT read source files — the content above is the convention to document.`,
		].join(" ");

		const child = spawn("pi", ["-p", "--skill", skillPath, prompt], {
			cwd: projectRoot,
			stdio: "ignore",
			detached: false,
		});

		let settled = false;

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			if (code === 0) {
				resolvePromise();
			} else {
				reject(new Error(`Pi agent exited with code ${code}`));
			}
		});

		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				process.kill(child.pid ?? -1, "SIGTERM");
			} catch {
				// ignore
			}
			reject(new Error("Pi agent timed out after 5 minutes"));
		}, timeoutMs);

		child.on("close", () => clearTimeout(timer));
	});
}
