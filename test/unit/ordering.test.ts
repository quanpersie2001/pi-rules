import { describe, expect, it } from "vitest";
import { compareRulesByPriority, sortRules } from "../../extension-src/pi-rules/domain/ordering.js";
import type { ParsedRule } from "../../extension-src/pi-rules/domain/types.js";

function makeRule(overrides: Partial<ParsedRule> & { relativePath: string }): ParsedRule {
	return {
		absolutePath: `/project/${overrides.relativePath}`,
		realPath: `/project/${overrides.relativePath}`,
		ruleId: overrides.ruleId ?? `rule_${overrides.relativePath}`,
		contentHash: "abc",
		fingerprint: "fake-fingerprint",
		frontmatter: overrides.frontmatter ?? {},
		body: overrides.body ?? "# body",
		diagnostics: overrides.diagnostics ?? [],
		...overrides,
	};
}

describe("compareRulesByPriority", () => {
	it("sorts higher priority first", () => {
		const low = makeRule({ relativePath: "low.md", frontmatter: { priority: 1 } });
		const high = makeRule({ relativePath: "high.md", frontmatter: { priority: 10 } });
		expect(compareRulesByPriority(high, low)).toBeLessThan(0);
		expect(compareRulesByPriority(low, high)).toBeGreaterThan(0);
	});

	it("treats missing priority as 0", () => {
		const missing = makeRule({ relativePath: "default.md" });
		const positive = makeRule({ relativePath: "explicit.md", frontmatter: { priority: 5 } });
		expect(compareRulesByPriority(missing, positive)).toBeGreaterThan(0);
		expect(compareRulesByPriority(positive, missing)).toBeLessThan(0);
	});

	it("treats two rules with missing priority as equal at the priority level", () => {
		const a = makeRule({ relativePath: "a.md" });
		const b = makeRule({ relativePath: "b.md" });
		expect(compareRulesByPriority(a, b)).not.toBe(0);
	});

	it("prefers shorter path depth for equal priority", () => {
		const general = makeRule({ relativePath: ".pi/rules/general.md", frontmatter: { priority: 5 } });
		const deep = makeRule({ relativePath: ".pi/rules/src/auth/oauth.md", frontmatter: { priority: 5 } });
		expect(compareRulesByPriority(general, deep)).toBeLessThan(0);
		expect(compareRulesByPriority(deep, general)).toBeGreaterThan(0);
	});

	it("breaks ties alphabetically when priority and depth match", () => {
		const a = makeRule({ relativePath: ".pi/rules/alpha.md", frontmatter: { priority: 5 } });
		const b = makeRule({ relativePath: ".pi/rules/beta.md", frontmatter: { priority: 5 } });
		expect(compareRulesByPriority(a, b)).toBeLessThan(0);
		expect(compareRulesByPriority(b, a)).toBeGreaterThan(0);
	});

	it("priority still wins over path depth", () => {
		const highButDeep = makeRule({
			relativePath: ".pi/rules/a/very/deep/nested/rule.md",
			frontmatter: { priority: 10 },
		});
		const lowButShort = makeRule({ relativePath: ".pi/rules/short.md", frontmatter: { priority: 1 } });
		expect(compareRulesByPriority(highButDeep, lowButShort)).toBeLessThan(0);
	});
});

describe("sortRules", () => {
	it("returns a NEW array (does not mutate the input)", () => {
		const input = [
			makeRule({ relativePath: ".pi/rules/b.md", frontmatter: { priority: 1 } }),
			makeRule({ relativePath: ".pi/rules/a.md", frontmatter: { priority: 5 } }),
		];
		const snapshot = [...input];
		const sorted = sortRules(input);
		expect(sorted).not.toBe(input);
		expect(input).toEqual(snapshot);
	});

	it("orders by priority descending, then depth, then alphabetical", () => {
		const rules = [
			makeRule({ relativePath: ".pi/rules/general/z.md", frontmatter: { priority: 1 } }),
			makeRule({ relativePath: ".pi/rules/a.md", frontmatter: { priority: 5 } }),
			makeRule({ relativePath: ".pi/rules/zzz/deep.md", frontmatter: { priority: 5 } }),
			makeRule({ relativePath: ".pi/rules/a/deep.md", frontmatter: { priority: 5 } }),
		];
		const sorted = sortRules(rules);
		expect(sorted.map((r) => r.relativePath)).toEqual([
			".pi/rules/a.md",
			".pi/rules/a/deep.md",
			".pi/rules/zzz/deep.md",
			".pi/rules/general/z.md",
		]);
	});

	it("returns an empty array for empty input", () => {
		expect(sortRules([])).toEqual([]);
	});
});
