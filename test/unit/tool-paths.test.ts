import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	extractPromptPaths,
	extractRemovedPaths,
	extractToolPaths,
} from "../../extension-src/pi-rules/features/tool-paths.js";

describe("extractToolPaths", () => {
	const projectRoot = "/project";

	it("extracts path from read tool", () => {
		const event = {
			toolName: "read",
			input: { path: "src/foo.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/foo.ts");
	});

	it("extracts path from write tool", () => {
		const event = {
			toolName: "write",
			input: { path: "src/bar.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/bar.ts");
	});

	it("extracts path from edit tool", () => {
		const event = {
			toolName: "edit",
			input: { path: "src/baz.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/baz.ts");
	});

	it("returns empty for tools without path input", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo hello" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(Array.isArray(paths)).toBe(true);
	});
});

describe("extractPromptPaths", () => {
	it("extracts file-like paths from text", () => {
		const paths = extractPromptPaths("edit src/foo.ts and check package.json");
		expect(paths).toContain("src/foo.ts");
		expect(paths).toContain("package.json");
	});

	it("returns empty for text without paths", () => {
		const paths = extractPromptPaths("hello world");
		expect(paths).toEqual([]);
	});

	it("deduplicates paths", () => {
		const paths = extractPromptPaths("src/foo.ts src/foo.ts");
		expect(paths.filter((p) => p === "src/foo.ts")).toHaveLength(1);
	});
});

describe("extractToolPaths with rm/mv commands", () => {
	const projectRoot = "/project";

	it("extracts path from rm command", () => {
		const event = {
			toolName: "bash",
			input: { command: "rm src/old-file.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/old-file.ts");
	});

	it("extracts path from rm -rf command", () => {
		const event = {
			toolName: "bash",
			input: { command: "rm -rf src/temp/" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/temp/");
	});

	it("extracts both paths from mv command", () => {
		const event = {
			toolName: "bash",
			input: { command: "mv src/old.ts src/new.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/old.ts");
		expect(paths).toContain("src/new.ts");
	});

	it("extracts paths from mv -f command", () => {
		const event = {
			toolName: "bash",
			input: { command: "mv -f src/a.ts src/b.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/a.ts");
		expect(paths).toContain("src/b.ts");
	});
});

describe("extractRemovedPaths", () => {
	const projectRoot = "/project";

	it("extracts path from simple rm command", () => {
		const paths = extractRemovedPaths("rm src/old-file.ts", projectRoot);
		expect(paths).toContain("src/old-file.ts");
	});

	it("extracts path from rm -rf command", () => {
		const paths = extractRemovedPaths("rm -rf src/temp/", projectRoot);
		expect(paths).toContain("src/temp");
	});

	it("returns empty for non-rm commands", () => {
		const paths = extractRemovedPaths("ls src/", projectRoot);
		expect(paths).toEqual([]);
	});

	it("handles multiple rm commands", () => {
		const paths = extractRemovedPaths("rm src/a.ts && rm src/b.ts", projectRoot);
		expect(paths).toContain("src/a.ts");
		expect(paths).toContain("src/b.ts");
	});
});
