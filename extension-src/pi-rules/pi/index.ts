import { realpathSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mergeConfig, type PiRulesConfig, type PiRulesMode, readConfigFromEnv } from "../app/config.js";
import { addSessionHotPaths, type RuntimeState, resetTurnState } from "../app/state.js";
import { formatRuleContext } from "../domain/formatter.js";
import type { MatchedRule } from "../domain/types.js";
import { extractPromptPaths, extractRemovedPaths, extractToolPaths } from "../features/tool-paths.js";
import { startWatcher, type Watcher } from "../features/watcher.js";
import { findProjectRoot, normalizePath } from "../shared/path.js";
import { statusLineText } from "./banner.js";
import { registerCommands } from "./commands.js";
import { createRuntime, normalizeCandidatePath, type RuntimeDeps } from "./runtime.js";

const CODE_EDIT_KEYWORDS = [
	"fix",
	"bug",
	"error",
	"implement",
	"refactor",
	"rename",
	"move",
	"delete",
	"create",
	"add",
	"remove",
	"update",
	"change",
	"modify",
	"edit",
	"write",
	"test",
	"deploy",
	"build",
	"lint",
	"format",
	"commit",
	"push",
	"merge",
	"review",
	"check",
	"debug",
	"trace",
	"investigate",
	"optimize",
	"src/",
	"test/",
	"lib/",
	"app/",
	"pages/",
	"components/",
];

function isCodeRelatedPrompt(prompt: string): boolean {
	if (prompt.trim().length === 0) return true; // empty prompt = continuation, don't filter
	const lower = prompt.toLowerCase();
	return CODE_EDIT_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatMatches(matches: MatchedRule[], runtimeDeps: RuntimeDeps): string {
	return formatRuleContext(matches, runtimeDeps.engine.formatOptions).prompt;
}

export default function piRulesExtension(pi: ExtensionAPI): void {
	registerFlags(pi);

	let runtime = createRuntime(process.cwd(), mergeConfig(readConfigFromEnv(), readFlags(pi)));
	let watcher: Watcher | null = null;
	let reloadInFlight = false;

	function syncRuntime(cwd: string): void {
		const nextConfig = mergeConfig(readConfigFromEnv(), readFlags(pi));
		const nextProjectRoot = findProjectRoot(cwd);
		const projectChanged = nextProjectRoot !== runtime.state.projectRoot;
		const concurrencyChanged = nextConfig.maintainerConcurrency !== runtime.config.maintainerConcurrency;
		const limitsChanged =
			nextConfig.maxRuleChars !== runtime.config.maxRuleChars ||
			nextConfig.maxContextChars !== runtime.config.maxContextChars;

		if (projectChanged || concurrencyChanged || limitsChanged) {
			const previousState = runtime.state;
			runtime = createRuntime(cwd, nextConfig);
			for (const path of previousState.recentReadPaths) runtime.state.recentReadPaths.add(path);
			for (const path of previousState.recentChangedPaths) runtime.state.recentChangedPaths.add(path);
			runtime.state.lastContext = previousState.lastContext;
			runtime.state.gitStatusBeforeTurn = previousState.gitStatusBeforeTurn;
			return;
		}

		runtime.config = nextConfig;
	}

	registerCommands(pi, {
		getRuntime: () => runtime,
		syncRuntime,
		updateWidget,
	});

	pi.on("session_start", async (_event, ctx) => {
		runtime = createRuntime(ctx.cwd, mergeConfig(readConfigFromEnv(), readFlags(pi)));
		await runtime.queue.initialize();
		// Use loadRules with forceReload=true at startup to populate cache
		await runtime.engine.loadRules(ctx.cwd, true);
		await updateWidget(ctx);

		// Start file watcher for hot reload
		const rulesDir = resolve(runtime.state.projectRoot, ".pi/rules");
		let roots: string[] = [];
		try {
			await stat(rulesDir);
			roots = [rulesDir];
		} catch {
			// rules dir doesn't exist yet — nothing to watch
		}
		if (roots.length > 0) {
			watcher = startWatcher({
				roots,
				onChange: () => {
					if (reloadInFlight) return;
					reloadInFlight = true;
					runtime.engine.loadRules(ctx.cwd, true).finally(() => {
						reloadInFlight = false;
					});
				},
				debounceMs: 100,
			});
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		syncRuntime(ctx.cwd);
		runtime.engine.clearCache();
		resetTurnState(runtime.state);
		await runtime.queue.initialize();
		await updateWidget(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		syncRuntime(ctx.cwd);
		runtime.engine.resetTurn();
		resetTurnState(runtime.state);
		runtime.state.gitStatusBeforeTurn = await getGitStatus(pi, ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		syncRuntime(ctx.cwd);
		if (runtime.config.disabled || runtime.config.mode === "off" || runtime.config.mode === "dynamic") {
			return undefined;
		}

		const codeRelated = isCodeRelatedPrompt(event.prompt);

		// Build set of context file real paths to detect AGENTS.md / CLAUDE.md overlap
		const contextFileRealPaths = new Set<string>();
		for (const contextFile of event.systemPromptOptions.contextFiles ?? []) {
			contextFileRealPaths.add(contextFile.path);
			try {
				contextFileRealPaths.add(realpathSync.native(contextFile.path));
			} catch {
				// ignore
			}
		}

		const promptPaths = extractPromptPaths(event.prompt)
			.map(normalizeCandidatePath)
			.filter((path): path is string => path !== undefined);
		const baseTargets = dedupePaths([
			...runtime.state.recentReadPaths,
			...runtime.state.recentChangedPaths,
			...runtime.state.sessionHotPaths,
			...promptPaths,
		]);
		// Fallback: if the current turn has no path signals (e.g. right after
		// `session_compact` when the model has lost its working-set memory),
		// reuse the target paths from the last successful injection so the
		// previously relevant rules keep applying.
		const usingLastContextFallback =
			baseTargets.length === 0 && (runtime.state.lastContext?.targetPaths?.length ?? 0) > 0;
		const targetPaths =
			baseTargets.length > 0 ? baseTargets : dedupePaths(runtime.state.lastContext?.targetPaths ?? []);

		// Use matchRulesForPathsStatic to skip context-file-backed rules
		const context = await runtime.engine.matchRulesForPathsStatic(
			ctx.cwd,
			targetPaths,
			contextFileRealPaths,
			codeRelated ? event.prompt : undefined,
		);

		// For non-code prompts (but not when using lastContext fallback), filter out non-alwaysApply rules
		let filteredMatches = context.matches;
		if (!codeRelated && !usingLastContextFallback) {
			filteredMatches = context.matches.filter((m) => m.matchReason.type === "alwaysApply");
		}

		if (filteredMatches.length === 0) {
			return undefined;
		}

		// Re-format if we filtered matches
		const finalContext =
			filteredMatches.length !== context.matches.length
				? { ...context, matches: filteredMatches, prompt: formatMatches(filteredMatches, runtime) }
				: context;

		runtime.engine.markStaticInjectedBatch(finalContext.matches);
		runtime.state.lastContext = runtime.engine.recordInjection(targetPaths, finalContext);
		await updateWidget(ctx);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${finalContext.prompt}`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) {
			return undefined;
		}
		syncRuntime(ctx.cwd);
		const extractedPaths = extractToolPaths(event, runtime.state.projectRoot);
		trackToolPaths(runtime.state, event, extractedPaths);

		if (runtime.config.disabled || runtime.config.mode === "off" || runtime.config.mode === "static") {
			return undefined;
		}
		if (extractedPaths.length === 0) {
			return undefined;
		}

		// Use matchRulesForPathsDynamic to avoid re-injecting rules already injected this turn
		const context = await runtime.engine.matchRulesForPathsDynamic(ctx.cwd, extractedPaths);
		if (context.prompt.length === 0) {
			return undefined;
		}

		runtime.engine.markDynamicInjectedBatch(extractedPaths[0] ?? "_all", context.matches);
		runtime.state.lastContext = runtime.engine.recordInjection(extractedPaths, context);
		await updateWidget(ctx);
		return {
			content: [...event.content, { type: "text", text: context.prompt }],
		};
	});

	pi.on("agent_end", async (_event, ctx) => {
		syncRuntime(ctx.cwd);
		if (runtime.config.disabled || !runtime.config.maintainerEnabled) {
			return undefined;
		}

		const gitStatusAfterTurn = await getGitStatus(pi, ctx);
		const gitChangedPaths = diffGitStatus(runtime.state.gitStatusBeforeTurn, gitStatusAfterTurn);
		const changedPaths = filterMaintainedPaths(dedupePaths([...runtime.state.recentChangedPaths, ...gitChangedPaths]));
		if (changedPaths.length === 0) {
			return undefined;
		}

		await runtime.maintainer.startOrQueue(changedPaths, "agent_end");
		await updateWidget(ctx);
		return undefined;
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		if (watcher !== null) {
			await watcher.stop();
			watcher = null;
		}
		reloadInFlight = false;
	});

	pi.registerTool({
		name: "create_rule",
		label: "Create Rule",
		description: "Create a new .pi/rules markdown file with frontmatter",
		promptSnippet: "Create durable .pi/rules files when the user asks to persist a project convention.",
		promptGuidelines: ["Use create_rule when the user explicitly wants to save an instruction under .pi/rules."],
		parameters: Type.Object({
			name: Type.String({ description: "Safe filename stem for the rule" }),
			summary: Type.String({ description: "One-line routing summary" }),
			paths: Type.Array(Type.String({ description: "Project-relative glob pattern" }), {
				description: "Project-relative path scopes for the rule",
			}),
			body: Type.String({ description: "Markdown rule body" }),
			alwaysApply: Type.Optional(Type.Boolean({ description: "Apply to all turns" })),
			overwrite: Type.Optional(Type.Boolean({ description: "Overwrite if the file already exists" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ path: string }>> {
			syncRuntime(ctx.cwd);
			const fileName = sanitizeRuleName(params.name);
			const rulePath = resolve(runtime.state.projectRoot, ".pi/rules", `${fileName}.md`);
			const existing = await readFile(rulePath, "utf8").catch(() => undefined);
			if (existing !== undefined && params.overwrite !== true) {
				return {
					content: [{ type: "text", text: `Rule already exists at ${rulePath}. Re-run with overwrite=true.` }],
					details: { path: rulePath },
				};
			}

			const frontmatterLines = [
				"---",
				"paths:",
				...params.paths.map((path) => `  - ${JSON.stringify(path)}`),
				`summary: ${JSON.stringify(params.summary)}`,
				`alwaysApply: ${params.alwaysApply === true ? "true" : "false"}`,
				"---",
				"",
			];
			await mkdir(resolve(runtime.state.projectRoot, ".pi/rules"), { recursive: true });
			await writeFile(rulePath, `${frontmatterLines.join("\n")}${params.body.trim()}\n`, "utf8");
			runtime.engine.clearCache();
			await runtime.engine.loadRules(runtime.state.projectRoot, true);
			return {
				content: [{ type: "text", text: `Created rule at ${rulePath}` }],
				details: { path: rulePath },
			};
		},
	});

	async function updateWidget(ctx: ExtensionContext): Promise<void> {
		if (!runtime.config.widgetEnabled) {
			ctx.ui.setStatus("pi-rules", undefined);
			ctx.ui.setWidget("pi-rules", undefined);
			return;
		}

		const status = await runtime.engine.getStatus(ctx.cwd).catch(() => undefined);
		const ruleCount = status?.ruleCount ?? 0;
		const hasErrors = status?.diagnostics.some((diagnostic) => diagnostic.severity === "error") ?? false;

		ctx.ui.setStatus("pi-rules", statusLineText({ ruleCount, hasErrors }));
	}
}

function registerFlags(pi: ExtensionAPI): void {
	pi.registerFlag("pi-rules-disabled", {
		description: "Disable pi-rules injection and maintenance",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("pi-rules-mode", {
		description: "pi-rules mode: static, dynamic, both, or off",
		type: "string",
		default: "both",
	});
	pi.registerFlag("pi-rules-maintainer", {
		description: "Enable background pi-rules maintainer",
		type: "boolean",
		default: true,
	});
	pi.registerFlag("pi-rules-widget", {
		description: "Enable pi-rules status widget",
		type: "boolean",
		default: true,
	});
	pi.registerFlag("pi-rules-maintainer-concurrency", {
		description: "Maximum concurrent pi-rules maintainer runs",
		type: "string",
		default: "1",
	});
}

function readFlags(pi: ExtensionAPI): Partial<PiRulesConfig> {
	const mode = pi.getFlag("pi-rules-mode");
	return {
		disabled: pi.getFlag("pi-rules-disabled") === true,
		mode: isMode(mode) ? mode : undefined,
		maintainerEnabled: pi.getFlag("pi-rules-maintainer") === true,
		widgetEnabled: pi.getFlag("pi-rules-widget") === true,
		maintainerConcurrency: parsePositiveInteger(pi.getFlag("pi-rules-maintainer-concurrency")),
	};
}

function isMode(value: unknown): value is PiRulesMode {
	return value === "static" || value === "dynamic" || value === "both" || value === "off";
}

function parsePositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function trackToolPaths(state: RuntimeState, event: ToolResultEvent, extractedPaths: string[]): void {
	for (const path of extractedPaths) {
		if (["read", "grep", "find", "ls"].includes(event.toolName)) {
			state.recentReadPaths.add(path);
		}
		if (["write", "edit", "bash"].includes(event.toolName)) {
			state.recentChangedPaths.add(path);
		}
	}
	// Track removed paths for rm commands
	if (event.toolName === "bash" && typeof event.input.command === "string") {
		const removedPaths = extractRemovedPaths(event.input.command, state.projectRoot);
		for (const path of removedPaths) {
			state.recentChangedPaths.add(path);
		}
	}
	// Augment the across-turn session memory so that rule matching survives
	// turn boundaries and `session_compact`. Cap is enforced by `addSessionHotPaths`.
	addSessionHotPaths(state, extractedPaths);
}

async function getGitStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	try {
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd, signal: ctx.signal });
		return result.stdout;
	} catch {
		return "";
	}
}

function diffGitStatus(before: string, after: string): string[] {
	const beforeSet = new Set(before.split(/\r?\n/).filter(Boolean));
	return after
		.split(/\r?\n/)
		.filter(Boolean)
		.filter((line) => !beforeSet.has(line))
		.map((line) => normalizePath(line.slice(3).trim()))
		.filter((line) => line.length > 0);
}

function filterMaintainedPaths(paths: string[]): string[] {
	return paths.filter(
		(path) => !path.startsWith(".git/") && !path.startsWith("node_modules/") && !path.startsWith(".pi/.pi-rules/"),
	);
}

function dedupePaths(paths: Iterable<string>): string[] {
	return [...new Set([...paths].map((path) => normalizePath(path)).filter(Boolean))];
}

function sanitizeRuleName(name: string): string {
	const normalized = name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (normalized.length === 0) {
		throw new Error("Rule name must contain at least one alphanumeric character.");
	}
	return normalized;
}
