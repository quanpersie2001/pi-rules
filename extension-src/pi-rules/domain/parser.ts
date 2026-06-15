import { parseFrontmatter } from "../shared/frontmatter.js";
import { sha256 } from "../shared/hash.js";
import { RuleParseError } from "./errors.js";
import type { ParsedRule, RuleDiagnostic, RuleFile, RuleFrontmatter } from "./types.js";

export function parseRuleFile(ruleFile: RuleFile, content: string): ParsedRule {
	const diagnostics: RuleDiagnostic[] = [];
	let frontmatter: RuleFrontmatter = {};
	let body = content;

	try {
		const parsed = parseFrontmatter(content);
		frontmatter = normalizeFrontmatter(parsed.data, diagnostics, ruleFile.relativePath);
		body = parsed.content;
	} catch (error) {
		throw new RuleParseError(ruleFile.relativePath, error);
	}

	return {
		...ruleFile,
		contentHash: sha256(content),
		frontmatter,
		body,
		diagnostics,
	};
}

function normalizeFrontmatter(
	input: Record<string, unknown>,
	diagnostics: RuleDiagnostic[],
	rulePath: string,
): RuleFrontmatter {
	const frontmatter: RuleFrontmatter = {};

	if (typeof input.summary === "string") frontmatter.summary = input.summary;
	if (typeof input.alwaysApply === "boolean") frontmatter.alwaysApply = input.alwaysApply;
	if (typeof input.description === "string") frontmatter.description = input.description;
	if (typeof input.priority === "number") frontmatter.priority = input.priority;

	frontmatter.paths = normalizeStringOrArray(input.paths, "paths", diagnostics, rulePath);
	frontmatter.paths = normalizeStringOrArray(input.paths, "paths", diagnostics, rulePath);
	frontmatter.triggers = normalizeStringArray(input.triggers, "triggers", diagnostics, rulePath);

	if (input.kind !== undefined) {
		if (input.kind === "rules" || input.kind === "inventory") {
			frontmatter.kind = input.kind;
		} else {
			diagnostics.push({
				severity: "warning",
				rulePath,
				message: `Ignoring invalid kind; expected "rules" or "inventory", got "${String(input.kind)}"`,
			});
		}
	}

	return frontmatter;
}

function normalizeStringOrArray(
	value: unknown,
	fieldName: string,
	diagnostics: RuleDiagnostic[],
	rulePath: string,
): string | string[] | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return value as string[];
	}
	diagnostics.push({
		severity: "warning",
		rulePath,
		message: `Ignoring invalid ${fieldName}; expected string or string[]`,
	});
	return undefined;
}

function normalizeStringArray(
	value: unknown,
	fieldName: string,
	diagnostics: RuleDiagnostic[],
	rulePath: string,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		return value as string[];
	}
	if (typeof value === "string") {
		return [value];
	}
	diagnostics.push({
		severity: "warning",
		rulePath,
		message: `Ignoring invalid ${fieldName}; expected string[]`,
	});
	return undefined;
}
