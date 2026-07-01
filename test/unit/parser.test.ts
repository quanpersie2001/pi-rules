import { describe, expect, it } from "vitest";
import { parseRuleFile } from "../../extension-src/pi-rules/domain/parser.js";
import type { RuleFile } from "../../extension-src/pi-rules/domain/types.js";

function makeRuleFile(relativePath: string): RuleFile {
	return {
		absolutePath: `/project/.pi/rules/${relativePath}`,
		realPath: `/project/.pi/rules/${relativePath}`,
		relativePath,
		ruleId: `test_${relativePath}`,
		contentHash: "abc123",
		fingerprint: "fake-fingerprint",
	};
}

describe("parseRuleFile", () => {
	it("parses valid frontmatter with paths array", () => {
		const content = `---
paths:
  - "src/**/*.ts"
summary: TypeScript rules
alwaysApply: false
---
# Body
content here`;
		const result = parseRuleFile(makeRuleFile("test.md"), content);
		expect(result.frontmatter.paths).toEqual(["src/**/*.ts"]);
		expect(result.frontmatter.summary).toBe("TypeScript rules");
		expect(result.frontmatter.alwaysApply).toBe(false);
		expect(result.body).toBe("# Body\ncontent here");
		expect(result.diagnostics).toHaveLength(0);
	});

	it("parses alwaysApply rule", () => {
		const content = `---
alwaysApply: true
summary: Global rules
---
# Always apply body`;
		const result = parseRuleFile(makeRuleFile("global.md"), content);
		expect(result.frontmatter.alwaysApply).toBe(true);
		expect(result.frontmatter.summary).toBe("Global rules");
	});

	it("parses guard rule", () => {
		const content = `---
paths:
  - "src/**/*.ts"
guard: true
summary: Guarded rules
---
# Guarded body`;
		const result = parseRuleFile(makeRuleFile("guarded.md"), content);
		expect(result.frontmatter.guard).toBe(true);
	});

	it("parses single string paths", () => {
		const content = `---
paths: "src/**/*.ts"
summary: Single path
---
body`;
		const result = parseRuleFile(makeRuleFile("single.md"), content);
		expect(result.frontmatter.paths).toBe("src/**/*.ts");
	});

	it("handles missing frontmatter gracefully", () => {
		const content = "# Just a markdown file\nno frontmatter here";
		const result = parseRuleFile(makeRuleFile("plain.md"), content);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("# Just a markdown file\nno frontmatter here");
	});

	it("handles malformed frontmatter gracefully", () => {
		const content = `---
invalid yaml: [foo
---
body`;
		const result = parseRuleFile(makeRuleFile("bad.md"), content);
		// Zero-dependency parser skips unparseable lines instead of throwing
		expect(result.body).toBe("body");
	});

	it("parses priority field", () => {
		const content = `---
priority: 10
summary: High priority
---
body`;
		const result = parseRuleFile(makeRuleFile("priority.md"), content);
		expect(result.frontmatter.priority).toBe(10);
	});

	it("parses kind: rules", () => {
		const content = `---
kind: rules
summary: Test
---
body`;
		const result = parseRuleFile(makeRuleFile("test.md"), content);
		expect(result.frontmatter.kind).toBe("rules");
		expect(result.diagnostics).toHaveLength(0);
	});

	it("parses kind: inventory", () => {
		const content = `---
kind: inventory
summary: Inventory
---
body`;
		const result = parseRuleFile(makeRuleFile("inv.md"), content);
		expect(result.frontmatter.kind).toBe("inventory");
		expect(result.diagnostics).toHaveLength(0);
	});

	it("produces warning for invalid kind value", () => {
		const content = `---
kind: invalid
summary: Test
---
body`;
		const result = parseRuleFile(makeRuleFile("bad-kind.md"), content);
		expect(result.frontmatter.kind).toBeUndefined();
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].severity).toBe("warning");
		expect(result.diagnostics[0].message).toContain("kind");
		expect(result.diagnostics[0].message).toContain("invalid");
	});

	it("kind defaults to undefined when not specified", () => {
		const content = `---
summary: Test
---
body`;
		const result = parseRuleFile(makeRuleFile("no-kind.md"), content);
		expect(result.frontmatter.kind).toBeUndefined();
		expect(result.diagnostics).toHaveLength(0);
	});

	it("parses triggers array", () => {
		const content = `---
triggers:
  - "fix auth"
  - "authentication bug"
summary: Auth rules
---
body`;
		const result = parseRuleFile(makeRuleFile("triggers.md"), content);
		expect(result.frontmatter.triggers).toEqual(["fix auth", "authentication bug"]);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("parses single string trigger as array", () => {
		const content = `---
triggers: "fix auth"
summary: Auth rules
---
body`;
		const result = parseRuleFile(makeRuleFile("single-trigger.md"), content);
		expect(result.frontmatter.triggers).toEqual(["fix auth"]);
	});

	it("triggers defaults to undefined when not specified", () => {
		const content = `---
summary: Test
---
body`;
		const result = parseRuleFile(makeRuleFile("no-triggers.md"), content);
		expect(result.frontmatter.triggers).toBeUndefined();
	});

	it("produces warning for invalid triggers type", () => {
		const content = `---
triggers: 123
summary: Test
---
body`;
		const result = parseRuleFile(makeRuleFile("bad-triggers.md"), content);
		expect(result.frontmatter.triggers).toBeUndefined();
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].message).toContain("triggers");
	});
});
