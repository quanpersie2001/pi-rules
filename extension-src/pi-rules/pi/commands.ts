import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InjectionRecord, RuleStatus } from "../domain/types.js";
import { computeExtensionSummary } from "../features/recommendation-store.js";
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
 *
 * The commands are intentionally side-effect-only: they call `syncRuntime` to
 * pick up the latest cwd/config, then delegate to the underlying services.
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

	pi.registerCommand("pi-rules:preview", {
		description: "Show what changed and why a rule may need updating",
		handler: async (args, ctx) => {
			runtime.syncRuntime(ctx.cwd);
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /pi-rules:preview <id>", "warning");
				return;
			}

			const current = runtime.getRuntime();
			const rec = await current.store.getById(id);
			if (rec === undefined) {
				ctx.ui.notify(`Recommendation ${id} not found.`, "warning");
				return;
			}

			const ruleContent = await readFile(rec.rulePath, "utf8").catch(() => undefined);
			const preview = formatSummaryPreview(rec, ruleContent);
			ctx.ui.notify(preview, "info");
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
		fileCount?: number;
		extensionSummary?: string;
		mergeCount: number;
		createdAt: number;
	}>,
): string {
	const lines = ["📋 Pending Recommendations:"];
	for (const rec of pending) {
		lines.push(`  [${rec.id}] ${rec.ruleRelativePath}`);
		const summary = rec.extensionSummary ?? computeExtensionSummary(rec.changedFiles);
		lines.push(`    📦 ${summary}${rec.mergeCount > 1 ? ` (merged ${rec.mergeCount}x)` : ""}`);
		lines.push(`    🕐 ${toIsoDate(rec.createdAt)}`);
	}
	if (pending.length === 0) {
		lines.push("  (none)");
	}
	lines.push("");
	lines.push("  /pi-rules:approve <id>   — Apply");
	lines.push("  /pi-rules:preview <id>   — Preview details");
	lines.push("  /pi-rules:cancel  <id>   — Dismiss");
	lines.push("  /pi-rules:approve-all    — Apply all pending");
	lines.push("  /pi-rules:cancel-all     — Dismiss all pending");
	return lines.join("\n");
}

/**
 * Known "pattern" directory names that signal new conventions in changed files.
 */
const PATTERN_DIRS = new Set([
	"Commands",
	"Queries",
	"Handlers",
	"Validators",
	"DTOs",
	"Events",
	"Services",
	"Repositories",
	"Readers",
	"Results",
	"Mappers",
	"Facades",
	"Requests",
	"Responses",
	"Migrations",
	"Seeding",
	"Specifications",
]);

/**
 * Extract section headings from markdown (lines starting with ## or ###).
 */
function extractHeadings(content: string): string[] {
	return (content.match(/^#{2,3}\s+.*$/gm) ?? []).map((h) => h.replace(/^#+\s*/, ""));
}

/**
 * Group changed files by their first meaningful subdirectory.
 * E.g. "src/Modules/Identity/AccessManagement/Commands/CreateRole.cs"
 *       → "Identity/AccessManagement/Commands"
 */
function groupFilesByPattern(changedFiles: string[]): Map<string, number> {
	const groups = new Map<string, number>();
	for (const file of changedFiles) {
		// Find a known pattern dir in the path
		const parts = file.split("/");
		let matched = "";
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part !== undefined && PATTERN_DIRS.has(part)) {
				matched = parts.slice(Math.max(0, i - 1), i + 1).join("/");
				break;
			}
		}
		if (matched) {
			groups.set(matched, (groups.get(matched) ?? 0) + 1);
		}
	}
	return groups;
}

/**
 * Detect which patterns in changed files are NOT yet documented in the rule.
 */
function findMissingTopics(ruleContent: string | undefined, patternGroups: Map<string, number>): string[] {
	if (ruleContent === undefined) return [];
	const headings = extractHeadings(ruleContent).map((h) => h.toLowerCase());
	const contentLower = ruleContent.toLowerCase();
	const missing: string[] = [];

	for (const [pattern] of patternGroups) {
		const parts = pattern.split("/");
		const dirName = parts[parts.length - 1] ?? "";
		const dirLower = dirName.toLowerCase();
		// Check if rule already mentions this pattern
		if (!headings.some((h) => h.includes(dirLower)) && !contentLower.includes(dirLower)) {
			missing.push(pattern);
		}
	}

	return missing;
}

/**
 * Quick summary preview: what changed, why the rule might need updating.
 * No agent spawn — purely heuristic, instant.
 */
export function formatSummaryPreview(
	rec: {
		id: string;
		ruleRelativePath: string;
		rulePath: string;
		changedFiles: string[];
		fileCount: number;
		extensionSummary: string;
		reason: string;
		mergeCount: number;
		createdAt: number;
	},
	ruleContent: string | undefined,
): string {
	const lines: string[] = [];

	lines.push("━".repeat(48));
	lines.push(`  ${rec.ruleRelativePath}`);
	lines.push(`  ${rec.extensionSummary}`);
	lines.push("");

	// Group changed files by pattern
	const groups = groupFilesByPattern(rec.changedFiles);

	if (groups.size > 0) {
		lines.push("  Các nhóm thay đổi chính:");
		for (const [dir, count] of [...groups.entries()].sort(([, a], [, b]) => b - a)) {
			lines.push(`    • ${dir}  (${count} files)`);
		}
		lines.push("");

		// Detect missing topics
		const missing = findMissingTopics(ruleContent, groups);
		if (missing.length > 0) {
			lines.push("  ⚠️  Rule hiện tại chưa đề cập đến:");
			for (const topic of missing) {
				lines.push(`    - ${topic}`);
			}
			lines.push("");
			lines.push("  ➡️  Có thể cần cập nhật rule để bao gồm các pattern mới.");
		} else {
			lines.push("  ✅ Các pattern này đã được rule đề cập.");
		}
	} else {
		lines.push("  Các file thay đổi không thuộc pattern đặc biệt nào.");
	}

	lines.push("");
	lines.push("  Dùng /pi-rules:approve để agent tự động cập nhật rule.");
	lines.push("  Dùng /pi-rules:cancel nếu rule không cần thay đổi.");
	lines.push("━".repeat(48));

	return lines.join("\n");
}
