import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InjectionRecord, RuleStatus } from "../domain/types.js";
import { toIsoDate } from "../shared/time.js";
import { runDoctor } from "./doctor.js";
import { normalizeCandidatePath, type RuntimeDeps } from "./runtime.js";

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
 *
 * The commands are intentionally side-effect-only: they call `syncRuntime` to
 * pick up the latest cwd/config, then delegate to the underlying services.
 */
export function registerCommands(pi: ExtensionAPI, runtime: CommandRuntime): void {
	pi.registerCommand("pi-rules:init", {
		description: "Invoke the init-advanced skill",
		handler: async (_args, ctx) => {
			if (ctx.isIdle()) {
				pi.sendUserMessage("/skill:init-advanced");
			} else {
				pi.sendUserMessage("/skill:init-advanced", { deliverAs: "followUp" });
			}
		},
	});

	pi.registerCommand("pi-rules:maintain", {
		description: "Create recommendation for specified files",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const paths = args
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map(normalizeCandidatePath)
				.filter((path): path is string => path !== undefined);
			if (paths.length === 0) {
				ctx.ui.notify("Usage: /pi-rules:maintain <file1> [file2...]", "warning");
				return;
			}

			const current = runtime.getRuntime();
			const results = await current.recommender.recommend(paths, "manual");
			ctx.ui.notify(`${results.length} recommendation(s) created/updated.`, "info");
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:status", {
		description: "Show discovered rules and pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const status = await current.engine.getStatus(ctx.cwd);
			const pending = await current.store.getPending();
			ctx.ui.notify(formatStatus(status, pending.length), "info");
			if (pending.length > 0) {
				ctx.ui.notify(formatRecommendationStatus(pending), "info");
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
			await current.store.approve(id);
			const result = await current.recommender.apply(id);
			ctx.ui.notify(result.message, result.success ? "info" : "error");
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:approve-all", {
		description: "Approve and apply all pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const pending = await current.store.getPending();
			if (pending.length === 0) {
				ctx.ui.notify("No pending recommendations.", "info");
				return;
			}
			for (const rec of pending) {
				await current.store.approve(rec.id);
			}
			const results = await current.recommender.applyAll();
			const succeeded = results.filter((r) => r.success).length;
			ctx.ui.notify(`Applied ${succeeded}/${results.length} recommendation(s).`, "info");
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
			const result = await current.store.cancel(id);
			ctx.ui.notify(
				result ? `Cancelled ${id}` : `Recommendation ${id} not found or not pending`,
				result ? "info" : "warning",
			);
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:cancel-all", {
		description: "Cancel all pending recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const pending = await current.store.getPending();
			if (pending.length === 0) {
				ctx.ui.notify("No pending recommendations.", "info");
				return;
			}
			for (const rec of pending) {
				await current.store.cancel(rec.id);
			}
			ctx.ui.notify(`Cancelled ${pending.length} recommendation(s).`, "info");
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:cleanup", {
		description: "Remove old completed/error recommendations",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const removed = await current.recommender.cleanup();
			ctx.ui.notify(`Removed ${removed} old recommendation(s).`, "info");
		},
	});

	pi.registerCommand("pi-rules:recommendations-log", {
		description: "Show the tail of the recommendations log",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const content = await current.store.readLogTail(current.config.maintainerLogLines);
			ctx.ui.notify(content || "Recommendations log is empty.", "info");
		},
	});
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

export function formatRecommendationStatus(
	pending: Array<{
		id: string;
		ruleRelativePath: string;
		changedFiles: string[];
		mergeCount: number;
		createdAt: number;
	}>,
): string {
	const lines = ["📋 Pending Recommendations:"];
	for (const rec of pending) {
		lines.push(`  [${rec.id}] ${rec.ruleRelativePath}`);
		lines.push(
			`    Changed: ${rec.changedFiles.join(", ")}${rec.mergeCount > 1 ? ` (merged ${rec.mergeCount}x)` : ""}`,
		);
		lines.push(`    Created: ${toIsoDate(rec.createdAt)}`);
	}
	lines.push("");
	lines.push("Use /pi-rules:approve <id> to apply, /pi-rules:cancel <id> to dismiss");
	return lines.join("\n");
}
