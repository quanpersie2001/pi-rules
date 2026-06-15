import { describe, expect, it } from "vitest";
import {
	ProjectRootNotFoundError,
	RuleDiagnosticError,
	RuleParseError,
} from "../../extension-src/pi-rules/domain/errors.js";

describe("RuleParseError", () => {
	it("preserves filePath and a useful message including the cause", () => {
		const cause = new Error("unexpected end of frontmatter");
		const error = new RuleParseError(".pi/rules/broken.md", cause);
		expect(error.filePath).toBe(".pi/rules/broken.md");
		expect(error.message).toContain(".pi/rules/broken.md");
		expect(error.message).toContain("unexpected end of frontmatter");
	});

	it("handles a non-Error cause without throwing", () => {
		const error = new RuleParseError(".pi/rules/x.md", "string-cause");
		expect(error.filePath).toBe(".pi/rules/x.md");
		expect(error.message).toContain(".pi/rules/x.md");
		expect(error.message).not.toContain("string-cause");
	});

	it("sets `name` to the class name", () => {
		const error = new RuleParseError(".pi/rules/x.md", new Error("x"));
		expect(error.name).toBe("RuleParseError");
	});

	it("is an instance of Error", () => {
		const error = new RuleParseError(".pi/rules/x.md", new Error("x"));
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(RuleParseError);
	});
});

describe("RuleDiagnosticError", () => {
	it("preserves severity, rulePath, and message", () => {
		const error = new RuleDiagnosticError("error", ".pi/rules/x.md", "invalid priority");
		expect(error.severity).toBe("error");
		expect(error.rulePath).toBe(".pi/rules/x.md");
		expect(error.message).toBe("invalid priority");
	});

	it("accepts a warning severity", () => {
		const error = new RuleDiagnosticError("warning", ".pi/rules/x.md", "deprecated field");
		expect(error.severity).toBe("warning");
	});

	it("accepts an undefined rulePath", () => {
		const error = new RuleDiagnosticError("warning", undefined, "no file context");
		expect(error.rulePath).toBeUndefined();
	});

	it("sets `name` to the class name and is an instance of Error", () => {
		const error = new RuleDiagnosticError("error", ".pi/rules/x.md", "x");
		expect(error.name).toBe("RuleDiagnosticError");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(RuleDiagnosticError);
	});
});

describe("ProjectRootNotFoundError", () => {
	it("preserves startPath and a useful message", () => {
		const error = new ProjectRootNotFoundError("/tmp/somewhere");
		expect(error.startPath).toBe("/tmp/somewhere");
		expect(error.message).toContain("/tmp/somewhere");
	});

	it("sets `name` to the class name and is an instance of Error", () => {
		const error = new ProjectRootNotFoundError("/tmp");
		expect(error.name).toBe("ProjectRootNotFoundError");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ProjectRootNotFoundError);
	});
});
