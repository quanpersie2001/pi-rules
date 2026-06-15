import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InjectionRecord, RuleStatus } from "../domain/types.js";
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
		description: "Run rules maintenance for changed paths",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const paths = args
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map(normalizeCandidatePath)
				.filter((path): path is string => path !== undefined);
			if (paths.length === 0) {
				ctx.ui.notify("Usage: /pi-rules:maintain <changed-file> [more-files...]", "warning");
				return;
			}

			const current = runtime.getRuntime();
			const result = await current.maintainer.startOrQueue(paths, "manual");
			ctx.ui.notify(result.message, "info");
			await runtime.updateWidget(ctx);
		},
	});

	pi.registerCommand("pi-rules:status", {
		description: "Show discovered rules and diagnostics",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const status = await current.engine.getStatus(ctx.cwd);
			ctx.ui.notify(formatStatus(status), "info");
		},
	});

	pi.registerCommand("pi-rules:context", {
		description: "Show last injected pi-rules context",
		handler: async (_args, ctx) => {
			const current = runtime.getRuntime();
			ctx.ui.notify(formatContext(current.state.lastContext), "info");
		},
	});

	pi.registerCommand("pi-rules:maintainer-status", {
		description: "Show maintainer queue and active runs",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			await current.queue.initialize();
			const activeRuns = await current.queue.readActiveRuns();
			const queue = await current.queue.peekQueue();
			const lock = await current.queue.readLock();
			ctx.ui.notify(formatMaintainerStatus(activeRuns.runs, queue.length, lock?.runId), "info");
		},
	});

	pi.registerCommand("pi-rules:maintainer-log", {
		description: "Show maintainer log tail",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const content = await current.queue.readLogTail(current.config.maintainerLogLines);
			ctx.ui.notify(content || "Maintainer log is empty.", "info");
		},
	});

	pi.registerCommand("pi-rules:maintainer-kill", {
		description: "Kill the oldest active maintainer run",
		handler: async (_args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const current = runtime.getRuntime();
			const activeRuns = await current.queue.readActiveRuns();
			const run = activeRuns.runs[0];
			if (run === undefined) {
				ctx.ui.notify("No active maintainer run.", "warning");
				return;
			}

			const killed = await current.maintainer.killRun(run.id);
			if (killed) {
				await current.maintainer.startNextQueuedBatch();
			}
			ctx.ui.notify(killed ? `Killed ${run.id}` : `Failed to kill ${run.id}`, killed ? "info" : "error");
			await runtime.updateWidget(ctx);
		},
	});
}

export function formatStatus(status: RuleStatus): string {
	const lines = [
		`Project root: ${status.projectRoot}`,
		`Rules dir: ${status.rulesDir}`,
		`Rule files: ${status.ruleCount}`,
		`Diagnostics: ${status.diagnostics.length}`,
	];
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

export function formatMaintainerStatus(
	runs: Array<{ id: string; pid: number; paths: string[] }>,
	queueLength: number,
	lockRunId?: string,
): string {
	const lines = [`Active runs: ${runs.length}`, `Queue length: ${queueLength}`, `Lock: ${lockRunId ?? "none"}`];
	for (const run of runs) {
		lines.push(`- ${run.id} pid=${run.pid} paths=${run.paths.join(", ")}`);
	}
	return lines.join("\n");
}
