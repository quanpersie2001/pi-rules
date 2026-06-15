import type { ParsedRule } from "./types.js";

/**
 * Comparator that orders {@link ParsedRule} entries for stable presentation
 * in injected context blocks.
 *
 * Sort key (highest precedence first):
 *
 *  1. `frontmatter.priority` descending. Rules with a higher numeric
 *     priority sort first. Rules without an explicit priority sort as
 *     `0`, equal to any other priority-less rule.
 *  2. Path depth ascending. Rules with a shorter `relativePath` sort
 *     first, so general rules (`.pi/rules/general.md`) appear before
 *     specific ones (`.pi/rules/src/auth/oauth.md`). Depth is the
 *     number of non-empty path segments.
 *  3. `relativePath` ascending (alphabetical) as the final tiebreaker.
 */
export function compareRulesByPriority(a: ParsedRule, b: ParsedRule): number {
	const priorityDiff = (b.frontmatter.priority ?? 0) - (a.frontmatter.priority ?? 0);
	if (priorityDiff !== 0) return priorityDiff;

	const depthDiff = pathDepth(a.relativePath) - pathDepth(b.relativePath);
	if (depthDiff !== 0) return depthDiff;

	return a.relativePath.localeCompare(b.relativePath);
}

/**
 * Return a new array of {@link ParsedRule} entries sorted by
 * {@link compareRulesByPriority}. The input array is not mutated, so
 * callers can safely pass in shared / readonly rule lists.
 */
export function sortRules(rules: ReadonlyArray<ParsedRule>): ParsedRule[] {
	return [...rules].sort(compareRulesByPriority);
}

function pathDepth(relativePath: string): number {
	const normalized = relativePath.replaceAll("\\", "/");
	let depth = 0;
	let inSegment = false;
	for (let i = 0; i < normalized.length; i++) {
		const code = normalized.charCodeAt(i);
		const isSeparator = code === 47; // "/"
		if (!isSeparator && !inSegment) {
			depth++;
			inSegment = true;
		} else if (isSeparator) {
			inSegment = false;
		}
	}
	return depth;
}
