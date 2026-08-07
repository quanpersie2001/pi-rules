import { globMatch } from "../shared/glob.js";
import { normalizePath } from "../shared/path.js";
import { compareRulesByPriority } from "./ordering.js";
import type { MatchedRule, MatchReason, ParsedRule } from "./types.js";

export function matchRules(rules: ParsedRule[], targetPaths: string[]): MatchedRule[] {
	const normalizedTargets = [...new Set(targetPaths.map((path) => normalizePath(path)).filter(Boolean))];
	const matches: MatchedRule[] = [];

	for (const rule of rules) {
		if (rule.frontmatter.alwaysApply === true) {
			// alwaysApply rules match unless every target is excluded via ignorePath.
			// Empty target set (no path signals) keeps matching, preserving the
			// historical behavior for pure-text / continuation turns.
			if (normalizedTargets.length > 0 && normalizedTargets.every((target) => isTargetIgnored(rule, target))) {
				continue;
			}
			matches.push({ ...rule, matchReason: { type: "alwaysApply" } });
			continue;
		}

		const patterns = normalizePatterns(rule.frontmatter.paths);
		for (const targetPath of normalizedTargets) {
			if (isTargetIgnored(rule, targetPath)) {
				continue;
			}
			const matchedPattern = patterns.find((pattern) => safeMatch(pattern, targetPath));
			if (matchedPattern !== undefined) {
				matches.push({
					...rule,
					matchReason: { type: "path", targetPath, pattern: matchedPattern },
				});
				break;
			}
		}
	}

	return matches.sort(compareRulesByPriority);
}

function normalizePatterns(paths: string | string[] | undefined): string[] {
	if (paths === undefined) return [];
	const values = Array.isArray(paths) ? paths : [paths];
	return values.map((value) => normalizePath(value));
}

/**
 * True when the target path matches any `ignorePath` glob pattern of the rule.
 * Invalid patterns never exclude (consistent with `paths` matching).
 */
function isTargetIgnored(rule: ParsedRule, targetPath: string): boolean {
	const patterns = normalizePatterns(rule.frontmatter.ignorePath);
	if (patterns.length === 0) return false;
	return patterns.some((pattern) => safeMatch(pattern, targetPath));
}

function safeMatch(pattern: string, targetPath: string): boolean {
	try {
		return globMatch(targetPath, pattern);
	} catch {
		return false;
	}
}

export function matchByTriggers(rules: ParsedRule[], promptText: string): MatchedRule[] {
	const promptLower = promptText.toLowerCase();
	const matches: MatchedRule[] = [];
	for (const rule of rules) {
		if (!rule.frontmatter.triggers) continue;
		for (const trigger of rule.frontmatter.triggers) {
			if (promptLower.includes(trigger.toLowerCase())) {
				matches.push({ ...rule, matchReason: { type: "trigger", trigger } });
				break;
			}
		}
	}
	return matches.sort(compareRulesByPriority);
}

export function describeMatchReason(matchReason: MatchReason): string {
	if (matchReason.type === "alwaysApply") {
		return "alwaysApply: true";
	}
	if (matchReason.type === "trigger") {
		return `trigger: "${matchReason.trigger}"`;
	}
	return `${matchReason.targetPath} matched ${JSON.stringify(matchReason.pattern)}`;
}
