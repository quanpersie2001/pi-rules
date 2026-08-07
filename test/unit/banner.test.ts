import { describe, expect, it } from "vitest";
import {
	type AppliedRulesInput,
	renderAppliedRulesLines,
	statusLineText,
} from "../../extension-src/pi-rules/pi/banner.js";

function makeInput(overrides: Partial<AppliedRulesInput> = {}): AppliedRulesInput {
	const input: AppliedRulesInput = {
		rules: [
			{
				relativePath: "core/csharp.md",
				matchReason: { type: "path", targetPath: "src/App.cs", pattern: "**/*.cs" },
			},
			{
				relativePath: "architecture/module-structure.md",
				matchReason: { type: "path", targetPath: "src/Modules/Orders/CreateOrder.cs", pattern: "src/Modules/**" },
			},
		],
		...overrides,
	};
	return input;
}

describe("renderAppliedRulesLines", () => {
	it("renders tree lines only, without a header", () => {
		const lines = renderAppliedRulesLines(makeInput());
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/^├─/);
		expect(lines[1]).toMatch(/^└─/);
	});

	it("renders tree lines with aligned rule paths and match patterns", () => {
		const lines = renderAppliedRulesLines(makeInput());
		expect(lines[0]).toContain("core/csharp.md");
		expect(lines[0]).toContain("**/*.cs");
		expect(lines[1]).toContain("architecture/module-structure.md");
		expect(lines[1]).toContain("src/Modules/**");
		// Paths are left-aligned to the same width before the reason column.
		const reasonCol1 = lines[0].indexOf("**/*.cs");
		const reasonCol2 = lines[1].indexOf("src/Modules/**");
		expect(reasonCol1).toBe(reasonCol2);
	});

	it("describes alwaysApply and trigger matches", () => {
		const lines = renderAppliedRulesLines(
			makeInput({
				rules: [
					{ relativePath: "general.md", matchReason: { type: "alwaysApply" } },
					{ relativePath: "auth.md", matchReason: { type: "trigger", trigger: "fix auth" } },
				],
			}),
		);
		expect(lines[0]).toContain("alwaysApply");
		expect(lines[1]).toContain("trigger: fix auth");
	});

	it("renders nothing for an empty rule list", () => {
		const lines = renderAppliedRulesLines(makeInput({ rules: [] }));
		expect(lines).toEqual([]);
	});

	it("applies the theme fg function for dim hint styling", () => {
		const calls: Array<[string, string]> = [];
		const fg = (token: string, text: string): string => {
			calls.push([token, text]);
			return `{${token}:${text}}`;
		};
		const lines = renderAppliedRulesLines(makeInput(), fg);
		expect(lines[0]).toContain("{dim:");
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every(([token]) => token === "dim")).toBe(true);
	});
});

describe("statusLineText", () => {
	it("shows rule count and pending recommendations", () => {
		expect(statusLineText({ ruleCount: 3, hasErrors: false, pendingCount: 0 })).toBe("pi-rules: 3 rules ✓");
		expect(statusLineText({ ruleCount: 3, hasErrors: false, pendingCount: 2 })).toBe("pi-rules: 3 rules ✓ | 2 pending");
	});

	it("marks error diagnostics", () => {
		expect(statusLineText({ ruleCount: 1, hasErrors: true, pendingCount: 0 })).toBe("pi-rules: 1 rules ✓ (!)");
	});
});
