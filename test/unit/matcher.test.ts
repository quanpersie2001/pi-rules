import { describe, expect, it } from "vitest";
import { matchByTriggers, matchRules } from "../../extension-src/pi-rules/domain/matcher.js";
import type { ParsedRule } from "../../extension-src/pi-rules/domain/types.js";

function makeRule(overrides: Partial<ParsedRule> & { relativePath: string }): ParsedRule {
	return {
		absolutePath: `/project/.pi/rules/${overrides.relativePath}`,
		realPath: `/project/.pi/rules/${overrides.relativePath}`,
		ruleId: overrides.ruleId ?? `rule_${overrides.relativePath}`,
		contentHash: "abc",
		fingerprint: "fake-fingerprint",
		frontmatter: overrides.frontmatter ?? { paths: ["src/**/*.ts"] },
		body: overrides.body ?? "# body",
		diagnostics: overrides.diagnostics ?? [],
		...overrides,
	};
}

describe("matchRules", () => {
	it("matches alwaysApply rules regardless of target paths", () => {
		const rule = makeRule({
			relativePath: "general.md",
			frontmatter: { alwaysApply: true, summary: "Global" },
		});
		const matches = matchRules([rule], []);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchReason).toEqual({ type: "alwaysApply" });
	});

	it("matches path-scoped rules correctly", () => {
		const rule = makeRule({
			relativePath: "modules.md",
			frontmatter: { paths: ["src/Modules/**/*.cs"] },
		});
		const matches = matchRules([rule], ["src/Modules/Orders/CreateOrder.cs"]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchReason).toEqual({
			type: "path",
			targetPath: "src/Modules/Orders/CreateOrder.cs",
			pattern: "src/Modules/**/*.cs",
		});
	});

	it("does not match when path does not match", () => {
		const rule = makeRule({
			relativePath: "modules.md",
			frontmatter: { paths: ["src/Modules/**/*.cs"] },
		});
		const matches = matchRules([rule], ["src/Other/file.ts"]);
		expect(matches).toHaveLength(0);
	});

	it("sorts by priority descending, then by path", () => {
		const low = makeRule({
			relativePath: "low.md",
			frontmatter: { paths: ["**/*"], priority: 1 },
		});
		const high = makeRule({
			relativePath: "high.md",
			frontmatter: { paths: ["**/*"], priority: 10 },
		});
		const matches = matchRules([low, high], ["file.ts"]);
		expect(matches).toHaveLength(2);
		expect(matches[0].relativePath).toBe("high.md");
		expect(matches[1].relativePath).toBe("low.md");
	});

	it("handles invalid glob patterns gracefully", () => {
		const rule = makeRule({
			relativePath: "bad.md",
			frontmatter: { paths: ["[invalid"] },
		});
		const matches = matchRules([rule], ["file.ts"]);
		expect(matches).toHaveLength(0);
	});

	it("deduplicates rules matched by multiple targets", () => {
		const rule = makeRule({
			relativePath: "all.md",
			frontmatter: { paths: ["**/*.ts"] },
		});
		const matches = matchRules([rule], ["a.ts", "b.ts"]);
		expect(matches).toHaveLength(1);
	});
});

describe("matchByTriggers", () => {
	it("matches when trigger phrase is in prompt", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { triggers: ["fix auth", "authentication bug"] },
		});
		const matches = matchByTriggers([rule], "please fix auth login issue");
		expect(matches).toHaveLength(1);
		expect(matches[0].matchReason).toEqual({ type: "trigger", trigger: "fix auth" });
	});

	it("does not match when trigger phrase is not in prompt", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { triggers: ["fix auth", "authentication bug"] },
		});
		const matches = matchByTriggers([rule], "please help with database");
		expect(matches).toHaveLength(0);
	});

	it("matches one of multiple triggers for same rule", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { triggers: ["fix auth", "authentication bug", "login error"] },
		});
		const matches = matchByTriggers([rule], "there is a login error");
		expect(matches).toHaveLength(1);
		expect(matches[0].matchReason).toEqual({ type: "trigger", trigger: "login error" });
	});

	it("case insensitive matching", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { triggers: ["Fix Auth"] },
		});
		const matches = matchByTriggers([rule], "please FIX AUTH now");
		expect(matches).toHaveLength(1);
	});

	it("skips rules without triggers", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { paths: ["src/**/*.ts"] },
		});
		const matches = matchByTriggers([rule], "fix auth");
		expect(matches).toHaveLength(0);
	});

	it("deduplicates when trigger and path both match", () => {
		const rule = makeRule({
			relativePath: "auth.md",
			frontmatter: { paths: ["src/auth/**/*.ts"], triggers: ["fix auth"] },
			ruleId: "auth-rule",
		});
		// matchByTriggers and matchRules would both match this rule;
		// deduplication happens at the engine level via ruleId
		const triggerMatches = matchByTriggers([rule], "fix auth");
		const pathMatches = matchRules([rule], ["src/auth/login.ts"]);
		// Both produce a match for the same rule
		expect(triggerMatches).toHaveLength(1);
		expect(pathMatches).toHaveLength(1);
		expect(triggerMatches[0].ruleId).toBe(pathMatches[0].ruleId);
	});
});
