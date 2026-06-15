import { DEFAULT_BANNER_WIDTH } from "../app/constants.js";

/**
 * Data backing the TUI banner widget. `ruleCount` is the total number of
 * active rules (loaded into the engine), while `lastInjectedCount` is the
 * number of rules that were attached to the most recent injection.
 */
export interface BannerInput {
	ruleCount: number;
	projectRoot: string;
	changedPathsCount: number;
	lastInjectedCount: number;
	maintainerRunsCount: number;
}

export interface StatusLineInput {
	ruleCount: number;
	hasErrors: boolean;
}

/**
 * Render the multi-line banner content for `ctx.ui.setWidget`. Width defaults
 * to `process.stdout.columns` when available, otherwise `DEFAULT_BANNER_WIDTH`.
 */
export function renderBannerLines(input: BannerInput, width: number = resolveWidth()): string[] {
	const safeWidth = Math.max(8, width);
	const border = "─".repeat(safeWidth);
	return [
		border,
		`[pi-rules] ${input.ruleCount} active rules`,
		`Project root: ${input.projectRoot}`,
		`Changed paths: ${input.changedPathsCount}`,
		`Last injected: ${input.lastInjectedCount}`,
		`Maintainer runs: ${input.maintainerRunsCount}`,
		border,
	];
}

/**
 * Build the compact status line used by `ctx.ui.setStatus`.
 * Appends an error indicator when the engine has produced error-level diagnostics.
 */
export function statusLineText({ ruleCount, hasErrors }: StatusLineInput): string {
	const base = `[pi-rules] ${ruleCount} active`;
	return hasErrors ? `${base} (!)` : base;
}

function resolveWidth(): number {
	const columns = process.stdout?.columns;
	if (typeof columns === "number" && columns > 0) {
		return columns;
	}
	return DEFAULT_BANNER_WIDTH;
}
