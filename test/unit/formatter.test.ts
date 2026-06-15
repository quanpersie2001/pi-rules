import { describe, expect, it } from "vitest";
import { formatRuleContext, separateParentChild } from "../../extension-src/pi-rules/domain/formatter.js";
import type { MatchedRule } from "../../extension-src/pi-rules/domain/types.js";

const baseOptions = { maxRuleChars: 12_000, maxContextChars: 40_000 };

function makeMatchedRule(overrides: Partial<MatchedRule> & { relativePath: string }): MatchedRule {
	return {
		absolutePath: `/project/.pi/rules/${overrides.relativePath}`,
		realPath: `/project/.pi/rules/${overrides.relativePath}`,
		ruleId: `rule_${overrides.relativePath}`,
		contentHash: "abc",
		fingerprint: "fake-fingerprint",
		frontmatter: overrides.frontmatter ?? { paths: ["**/*.ts"] },
		body: overrides.body ?? "# Rule body\n- point 1\n- point 2",
		diagnostics: overrides.diagnostics ?? [],
		matchReason: overrides.matchReason ?? { type: "alwaysApply" },
		...overrides,
	};
}

describe("formatRuleContext", () => {
	it("returns empty prompt for empty matches", () => {
		const result = formatRuleContext([], baseOptions);
		expect(result.prompt).toBe("");
		expect(result.truncated).toBe(false);
	});

	it("formats a single matched rule", () => {
		const rule = makeMatchedRule({
			relativePath: "general.md",
			frontmatter: { alwaysApply: true, summary: "Global rules" },
			body: "# Global\nBe safe.",
			matchReason: { type: "alwaysApply" },
		});
		const result = formatRuleContext([rule], baseOptions);
		expect(result.prompt).toContain("<pi-rules-context>");
		expect(result.prompt).toContain("</pi-rules-context>");
		expect(result.prompt).toContain("## Rule: general.md");
		expect(result.prompt).toContain("alwaysApply: true");
		expect(result.prompt).toContain("Summary: Global rules");
		expect(result.prompt).toContain("Be safe.");
		expect(result.truncated).toBe(false);
	});

	it("formats multiple matched rules", () => {
		const rules = [
			makeMatchedRule({
				relativePath: "general.md",
				frontmatter: { alwaysApply: true },
				body: "# General",
				matchReason: { type: "alwaysApply" },
			}),
			makeMatchedRule({
				relativePath: "project.md",
				frontmatter: { paths: ["**/*"] },
				body: "# Project",
				matchReason: { type: "path", targetPath: "file.ts", pattern: "**/*" },
			}),
		];
		const result = formatRuleContext(rules, baseOptions);
		expect(result.prompt).toContain("## Rule: general.md");
		expect(result.prompt).toContain("## Rule: project.md");
	});

	it("truncates rule body exceeding maxRuleChars", () => {
		const longBody = "x".repeat(13_000);
		const rule = makeMatchedRule({
			relativePath: "long.md",
			frontmatter: { alwaysApply: true },
			body: longBody,
			matchReason: { type: "alwaysApply" },
		});
		const options = { maxRuleChars: 1_000, maxContextChars: 40_000 };
		const result = formatRuleContext([rule], options);
		expect(result.truncated).toBe(true);
		expect(result.prompt).toContain("[... truncated by pi-rules: long.md ...]");
	});

	it("truncates when total exceeds maxContextChars", () => {
		const rules = [
			makeMatchedRule({
				relativePath: "a.md",
				frontmatter: { alwaysApply: true },
				body: "b".repeat(30_000),
				matchReason: { type: "alwaysApply" },
			}),
			makeMatchedRule({
				relativePath: "b.md",
				frontmatter: { alwaysApply: true },
				body: "c".repeat(30_000),
				matchReason: { type: "alwaysApply" },
			}),
		];
		const options = { maxRuleChars: 40_000, maxContextChars: 5_000 };
		const result = formatRuleContext(rules, options);
		expect(result.truncated).toBe(true);
	});

	it("includes match reason description", () => {
		const rule = makeMatchedRule({
			relativePath: "scoped.md",
			frontmatter: { paths: ["src/**/*.ts"] },
			body: "# Scoped",
			matchReason: { type: "path", targetPath: "src/app.ts", pattern: "src/**/*.ts" },
		});
		const result = formatRuleContext([rule], baseOptions);
		expect(result.prompt).toContain("src/app.ts matched");
		expect(result.prompt).toContain('"src/**/*.ts"');
	});

	it("formats trigger match reason", () => {
		const rule = makeMatchedRule({
			relativePath: "auth.md",
			frontmatter: { triggers: ["fix auth"] },
			body: "# Auth rules",
			matchReason: { type: "trigger", trigger: "fix auth" },
		});
		const result = formatRuleContext([rule], baseOptions);
		expect(result.prompt).toContain('trigger: "fix auth"');
	});

	it("lists inventory matches as Available Inventories instead of injecting body", () => {
		const rules = [
			makeMatchedRule({
				relativePath: "auth.md",
				frontmatter: { alwaysApply: true, kind: "rules" },
				body: "# Auth rules body",
				matchReason: { type: "alwaysApply" },
			}),
			makeMatchedRule({
				relativePath: "components/buttons/inventory.md",
				frontmatter: { kind: "inventory", summary: "Button Inventory" },
				body: "# Full inventory body that should not appear",
				matchReason: { type: "path", targetPath: "src/foo.ts", pattern: "**/*" },
			}),
		];
		const result = formatRuleContext(rules, baseOptions);
		// Rules body should be injected
		expect(result.prompt).toContain("Auth rules body");
		expect(result.prompt).toContain("## Rule: auth.md");
		// Inventory body should NOT be injected
		expect(result.prompt).not.toContain("Full inventory body that should not appear");
		// Inventory should appear as listing
		expect(result.prompt).toContain("## Available Inventories");
		expect(result.prompt).toContain("components/buttons/inventory.md (Button Inventory)");
	});

	it("handles only inventory matches without rules matches", () => {
		const rules = [
			makeMatchedRule({
				relativePath: "buttons/inventory.md",
				frontmatter: { kind: "inventory", summary: "Buttons" },
				body: "# Inventory body",
				matchReason: { type: "path", targetPath: "src/foo.ts", pattern: "**/*" },
			}),
		];
		const result = formatRuleContext(rules, baseOptions);
		expect(result.prompt).toContain("## Available Inventories");
		expect(result.prompt).toContain("buttons/inventory.md (Buttons)");
		expect(result.prompt).not.toContain("# Inventory body");
	});
});

describe("separateParentChild", () => {
	it("returns empty parents when no parent-child relationship exists", () => {
		const matches = [
			makeMatchedRule({
				relativePath: "auth.md",
				frontmatter: { alwaysApply: true },
				matchReason: { type: "alwaysApply" },
			}),
			makeMatchedRule({
				relativePath: "db.md",
				frontmatter: { alwaysApply: true },
				matchReason: { type: "alwaysApply" },
			}),
		];
		const result = separateParentChild(matches);
		expect(result.children).toHaveLength(2);
		expect(result.parents).toHaveLength(0);
	});

	it("identifies parent when child has deeper path", () => {
		const matches = [
			makeMatchedRule({
				relativePath: "auth/rules.md",
				frontmatter: { paths: ["src/auth/**"] },
				matchReason: { type: "path", targetPath: "src/auth/login.ts", pattern: "src/auth/**" },
			}),
			makeMatchedRule({
				relativePath: "auth/login/rules.md",
				frontmatter: { paths: ["src/auth/login/**"] },
				matchReason: { type: "path", targetPath: "src/auth/login.ts", pattern: "src/auth/login/**" },
			}),
		];
		const result = separateParentChild(matches);
		expect(result.children).toHaveLength(1);
		expect(result.children[0].relativePath).toBe("auth/login/rules.md");
		expect(result.parents).toHaveLength(1);
		expect(result.parents[0].relativePath).toBe("auth/rules.md");
	});

	it("injects parent as summary only and child fully", () => {
		const matches = [
			makeMatchedRule({
				relativePath: "auth/rules.md",
				frontmatter: { paths: ["src/auth/**"], summary: "Auth parent rules" },
				body: "# Full parent body\n\nShould not be fully injected.",
				matchReason: { type: "path", targetPath: "src/auth/login.ts", pattern: "src/auth/**" },
			}),
			makeMatchedRule({
				relativePath: "auth/login/rules.md",
				frontmatter: { paths: ["src/auth/login/**"], summary: "Login rules" },
				body: "# Login rules body\n\nFull content here.",
				matchReason: { type: "path", targetPath: "src/auth/login.ts", pattern: "src/auth/login/**" },
			}),
		];
		const result = formatRuleContext(matches, baseOptions);
		// Child should be injected fully
		expect(result.prompt).toContain("# Login rules body");
		expect(result.prompt).toContain("## Rule: auth/login/rules.md");
		// Parent should be summary only
		expect(result.prompt).toContain("## Rule: auth/rules.md (parent summary)");
		expect(result.prompt).toContain("Summary: Auth parent rules");
		expect(result.prompt).toContain("Full rule available");
		expect(result.prompt).not.toContain("Should not be fully injected.");
	});
});
