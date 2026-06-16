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
