import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { computeExtensionSummary } from "../../extension-src/pi-rules/features/recommendation-store.js";
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

describe("extractToolPaths — bash noise filtering", () => {
	const projectRoot = "/project";

	it("filters shell redirects", () => {
		const event = {
			toolName: "bash",
			input: { command: "ls 2>/dev/null" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).not.toContain("2>/dev/null");
	});

	it("filters glob patterns", () => {
		const event = {
			toolName: "bash",
			input: { command: "find . -name '*.cs' -type f" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).not.toContain("*.cs");
	});

	it("filters numbered list items", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo 1. 2. 3." },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("filters code fragments with brackets", () => {
		const event = {
			toolName: "bash",
			input: { command: "jq '.data | to_entries[]' " },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("filters bare extensions", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo .cs .csproj .json" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("filters shebang token", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo #!/bin/bash" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		// "script.sh" IS a valid path, but "#!/bin/bash" should be filtered
		expect(paths).not.toContain("#!/bin/bash");
	});

	it("filters shell variables", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo $HOME $PWD" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("keeps valid relative paths", () => {
		const event = {
			toolName: "bash",
			input: { command: "cat src/foo.ts src/bar/baz.ts" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/foo.ts");
		expect(paths).toContain("src/bar/baz.ts");
	});

	it("filters pure version numbers", () => {
		const event = {
			toolName: "bash",
			input: { command: "echo 1.2.3 4.5.6" },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("filters paths with trailing triple dots (file.cs...)", () => {
		const event = {
			toolName: "bash",
			input: { command: "cat file.cs..." },
		} as unknown as ToolResultEvent;
		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toEqual([]);
	});

	it("extracts rm paths via dedicated pattern", () => {
		const event = {
			toolName: "bash",
			input: { command: "rm src/old-file.ts" },
		} as unknown as ToolResultEvent;

		const paths = extractToolPaths(event, projectRoot);
		expect(paths).toContain("src/old-file.ts");
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

describe("computeExtensionSummary", () => {
	it("returns 0 files for empty list", () => {
		expect(computeExtensionSummary([])).toBe("0 files");
	});

	it("single file", () => {
		expect(computeExtensionSummary(["src/foo.ts"])).toBe("1 file: 1 .ts");
	});

	it("multiple files with mixed extensions", () => {
		const result = computeExtensionSummary(["src/a.ts", "src/b.ts", "src/c.cs", "test/d.cs"]);
		expect(result).toBe("4 files: 2 .cs, 2 .ts");
	});

	it("files with uncommon extensions", () => {
		const result = computeExtensionSummary(["package.json", "tsconfig.json", "Dockerfile"]);
		expect(result).toContain("3 files");
		expect(result).toContain("2 .json");
		expect(result).toContain("1 (other)");
	});

	it("files with multiple dots", () => {
		const result = computeExtensionSummary(["src/app.module.ts", "src/test.spec.ts"]);
		expect(result).toBe("2 files: 2 .ts");
	});
});
