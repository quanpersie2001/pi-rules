import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InjectionRecord, RuleStatus } from "../domain/types.js";
import type { Recommendation } from "../features/recommendation-types.js";
import { toIsoDate } from "../shared/time.js";
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

	pi.registerCommand("pi-rules:preview", {
		description: "Show the content of a pending recommendation",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /pi-rules:preview <id>", "warning");
				return;
			}

			const current = runtime.getRuntime();
			await current.store.initialize();
			const rec = await current.store.getById(id);
			if (rec === undefined || rec.status !== "pending") {
				ctx.ui.notify(`Recommendation ${id} not found.`, "warning");
				return;
			}

			const ruleContent = await readFile(rec.rulePath, "utf8").catch(() => undefined);
			ctx.ui.notify(formatSummaryPreview(rec, ruleContent), "info");
		},
	});

	pi.registerCommand("pi-rules:approve", {
		description: "Approve and apply a recommendation",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /pi-rules:approve <id>", "warning");
				return;
			}

			const current = runtime.getRuntime();
			await current.store.initialize();
			const rec = await current.store.getById(id);
			if (rec === undefined || rec.status !== "pending") {
				ctx.ui.notify(`Recommendation ${id} not found.`, "warning");
				return;
			}

			await applyRecommendation(current, rec, ctx);
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:approve-all", {
		description: "Approve and apply all pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			await current.store.initialize();
			const recs = await current.store.getPending();
			if (recs.length === 0) {
				ctx.ui.notify("No pending recommendations.", "info");
				return;
			}

			let succeeded = 0;
			for (const rec of recs) {
				const ok = await applyRecommendation(current, rec, ctx, false);
				if (ok) succeeded++;
			}
			ctx.ui.notify(`Applied ${succeeded}/${recs.length} recommendation(s).`, "info");
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:cancel", {
		description: "Cancel/dismiss a recommendation",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /pi-rules:cancel <id>", "warning");
				return;
			}
			const current = runtime.getRuntime();
			await current.store.initialize();
			const cancelled = await current.store.cancel(id);
			ctx.ui.notify(
				cancelled ? `Cancelled ${id}` : `Recommendation ${id} not found or not pending`,
				cancelled ? "info" : "warning",
			);
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:cancel-all", {
		description: "Cancel all pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			await current.store.initialize();
			const recs = await current.store.getPending();
			for (const rec of recs) {
				await current.store.cancel(rec.id);
			}
			ctx.ui.notify(`Cancelled ${recs.length} recommendation(s).`, "info");
			await runtime.updateWidget(ctx);
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

export function formatRecommendationStatus(recs: Recommendation[]): string {
	const lines = ["📋 Pending Recommendations:"];
	for (const rec of recs) {
		lines.push(`  [${rec.id}] ${rec.ruleRelativePath}`);
		const firstLine = rec.summary.split("\n")[0] ?? "";
		if (firstLine.length > 0) {
			lines.push(`    📝 ${firstLine.trim()}`);
		}
		lines.push(`    🕐 ${toIsoDate(rec.createdAt)}`);
	}
	if (recs.length === 0) {
		lines.push("  (none)");
	}
	lines.push("");
	lines.push("  /pi-rules:preview <id>   — Show the full content to add");
	lines.push("  /pi-rules:approve <id>   — Apply (agent writes the rule)");
	lines.push("  /pi-rules:cancel  <id>   — Dismiss");
	lines.push("  /pi-rules:approve-all    — Apply all");
	lines.push("  /pi-rules:cancel-all     — Dismiss all");
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

export function formatSummaryPreview(
	rec: {
		id: string;
		ruleRelativePath: string;
		rulePath: string;
		summary: string;
		content: string;
		reason: string;
		createdAt: number;
	},
	ruleContent: string | undefined,
	options: { showCommandHints?: boolean } = {},
): string {
	const lines: string[] = [];

	lines.push("━".repeat(48));
	lines.push(`  ${rec.ruleRelativePath}`);
	lines.push(`  ${ruleContent !== undefined ? "Rule exists — content to add:" : "New rule — content to write:"}`);
	lines.push("");

	for (const line of rec.content.split("\n")) {
		if (line.trim().length > 0) {
			lines.push(`    ${line}`);
		} else {
			lines.push("");
		}
	}
	lines.push("");

	lines.push("  Why:");
	for (const line of rec.reason.split("\n")) {
		lines.push(`    ${line}`);
	}
	lines.push("");

	if (ruleContent !== undefined) {
		lines.push("  Current rule content (first lines):");
		const ruleLines = ruleContent.split("\n");
		for (const line of ruleLines.slice(0, 10)) {
			lines.push(`    ${line}`);
		}
		if (ruleLines.length > 10) {
			lines.push("    ...");
		}
		lines.push("");
	}

	if (options.showCommandHints !== false) {
		lines.push("  Use /pi-rules:approve to apply (agent will update the rule file).");
		lines.push("  Use /pi-rules:cancel  if no rule change is needed.");
	}
	lines.push("━".repeat(48));

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
