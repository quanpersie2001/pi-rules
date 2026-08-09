/**
 * Data backing the TUI banner widget. Only `ruleCount` is used in the
 * rendered output; the rest is kept for forward-compatibility.
 */
export interface BannerInput {
	ruleCount: number;
	projectRoot: string;
	changedPathsCount: number;
	lastInjectedCount: number;
	pendingCount: number;
}

export interface StatusLineInput {
	ruleCount: number;
	hasErrors: boolean;
	pendingCount: number;
}

/**
 * Theme tokens used by the applied-rules annotation. Kept as a narrow
 * union so the renderer stays pure and unit-testable without a TUI while
 * remaining assignable to pi's `ThemeColor`.
 */
export type ThemeFgToken = "dim";

/**
 * Theme function shape used by {@link renderAppliedRulesLines}.
 */
export type ThemeFg = (token: ThemeFgToken, text: string) => string;

/**
 * Render the multi-line banner content for `ctx.ui.setWidget`.
 * Only shows the active rules count — keep it minimal.
 */
export function renderBannerLines(input: BannerInput): string[] {
	return [`[pi-rules] ${input.ruleCount} active rules`];
}

/**
 * Build the compact status line used by `ctx.ui.setStatus`.
 * Appends an error indicator when the engine has produced error-level diagnostics.
 */
export function statusLineText({ ruleCount, hasErrors, pendingCount }: StatusLineInput): string {
	const base = `pi-rules: ${ruleCount} rules ✓`;
	const withPending = pendingCount > 0 ? `${base} | ${pendingCount} pending` : base;
	return hasErrors ? `${withPending} (!)` : withPending;
}

/**
 * Input for the "applied rules" annotation: the last injection record plus
 * the theme `fg` function. Rules are rendered as a dim tree so the
 * annotation stays unobtrusive (hint style) while still showing what was
 * injected.
 */
export interface AppliedRulesInput {
	/** Rule entries from `InjectionRecord.rules`. */
	rules: Array<{
		ruleId?: string;
		relativePath: string;
		summary?: string;
		matchReason: {
			type: "alwaysApply" | "path" | "trigger";
			targetPath?: string;
			pattern?: string;
			trigger?: string;
		};
	}>;
}

/**
 * Data stored in the `pi-rules-applied` chat entry. Rendered by the
 * registered entry renderer; never sent to the LLM.
 */
export type AppliedRulesEntryData = AppliedRulesInput;

/**
 * Render the applied-rules annotation lines shown in the chat transcript
 * after a turn's injection. Compact single-purpose tree with no header
 * line, so the annotation hugs the preceding transcript line.
 *
 * ```
 * ├─ core/csharp.md       **\/*.cs
 * └─ architecture/module-structure.md  src\/Modules\/**
 * ```
 *
 * Rule lines use `dim` ("hint mờ" style). Pass a passthrough `fg` in tests.
 */
function describeAppliedReason(reason: AppliedRulesInput["rules"][number]["matchReason"]): string {
	if (reason.type === "path") return reason.pattern ?? reason.targetPath ?? "path";
	if (reason.type === "trigger") return `trigger: ${reason.trigger ?? "?"}`;
	return "alwaysApply";
}

export function renderAppliedRulesLines(input: AppliedRulesInput, fg: ThemeFg = (_, text) => text): string[] {
	// A rule can be present more than once when a context was assembled from
	// several match sources. Keep the first occurrence so its first match
	// reason remains the one shown to the user.
	const seen = new Set<string>();
	const rules = input.rules.filter((rule) => {
		const key = rule.ruleId ?? rule.relativePath;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	if (rules.length === 0) {
		return [];
	}

	// Align rule paths to the widest entry so the reason column lines up.
	const maxPathLen = Math.max(...rules.map((rule) => rule.relativePath.length));
	const rendered = rules.map((rule) => ({
		path: rule.relativePath.padEnd(maxPathLen + 2),
		reason: describeAppliedReason(rule.matchReason),
	}));

	// Tree connectors: all-but-last get ├─, the last gets └─. No leading
	// indent — the annotation sits flush under the previous transcript line.
	const lines: string[] = [];
	for (let i = 0; i < rendered.length; i++) {
		const connector = i === rendered.length - 1 ? "└─" : "├─";
		lines.push(fg("dim", `${connector} ${rendered[i].path}${rendered[i].reason}`));
	}

	return lines;
}
