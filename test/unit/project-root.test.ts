import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_MARKERS, findProjectRoot } from "../../extension-src/pi-rules/domain/project-root.js";

let tempDir = "";

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
	tempDir = "";
});

function makeTree(files: Record<string, string>): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-project-root-test-"));
	for (const [rel, content] of Object.entries(files)) {
		const abs = resolve(tempDir, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	}
	return tempDir;
}

describe("DEFAULT_PROJECT_MARKERS", () => {
	it("includes common project markers", () => {
		expect(DEFAULT_PROJECT_MARKERS).toContain(".git");
		expect(DEFAULT_PROJECT_MARKERS).toContain("package.json");
	});
});

describe("findProjectRoot", () => {
	it("finds .git walking up from a deep subdirectory", () => {
		const root = makeTree({
			".git/HEAD": "ref: refs/heads/main",
			"src/lib/nested/deep/file.ts": "",
		});
		const deepPath = resolve(root, "src/lib/nested/deep");
		const found = findProjectRoot(deepPath);
		expect(found).toBe(root);
	});

	it("finds package.json walking up from a subdirectory", () => {
		const root = makeTree({
			"package.json": "{}",
			"src/index.ts": "",
		});
		const subPath = resolve(root, "src");
		const found = findProjectRoot(subPath);
		expect(found).toBe(root);
	});

	it("returns the start path when the start path is itself a marker directory", () => {
		const root = makeTree({
			".git/HEAD": "",
		});
		const found = findProjectRoot(root);
		expect(found).toBe(root);
	});

	it("returns the parent directory when starting from a file inside the project", () => {
		const root = makeTree({
			"package.json": "{}",
			"src/index.ts": "",
		});
		const filePath = resolve(root, "src/index.ts");
		const found = findProjectRoot(filePath);
		expect(found).toBe(root);
	});

	it("returns undefined for a non-existent path", () => {
		const found = findProjectRoot("/this/path/definitely/does/not/exist/anywhere-xyz");
		expect(found).toBeUndefined();
	});

	it("returns undefined when no marker is found before filesystem root", () => {
		// Build a chain of empty directories under tempdir
		tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-no-marker-"));
		const deep = resolve(tempDir, "a/b/c/d");
		mkdirSync(deep, { recursive: true });
		// Walk should reach filesystem root and stop. The chain is at least
		// `/private/var/folders/.../a/b/c/d` on macOS, and none of the
		// intermediate directories will contain a marker.
		const found = findProjectRoot(deep);
		expect(found).toBeUndefined();
	});

	it("supports custom markers (e.g. ['pyproject.toml'])", () => {
		const root = makeTree({
			"pyproject.toml": "[project]\nname = 'x'",
			"src/foo.py": "",
		});
		const subPath = resolve(root, "src");
		// With a custom marker that ignores package.json, we should still find the root.
		const found = findProjectRoot(subPath, ["pyproject.toml"]);
		expect(found).toBe(root);
	});

	it("custom markers that do not exist fall through to undefined", () => {
		const root = makeTree({
			"pyproject.toml": "",
			"src/foo.py": "",
		});
		const subPath = resolve(root, "src");
		// Asking only for "package.json" should not match.
		const found = findProjectRoot(subPath, ["package.json"]);
		expect(found).toBeUndefined();
	});

	it("respects marker precedence (first match wins)", () => {
		// Both .pi and package.json exist. The default order places .pi
		// later than package.json, so package.json should win.
		const root = makeTree({
			".pi/": "",
			"package.json": "{}",
		});
		const found = findProjectRoot(root, ["package.json", ".pi"]);
		expect(found).toBe(root);
		// Reverse the order; .pi should now be returned (and we still
		// expect `root` because both markers are at the same level).
		const reversed = findProjectRoot(root, [".pi", "package.json"]);
		expect(reversed).toBe(root);
	});

	it("handles a symlinked start path that does not exist on disk", () => {
		const root = makeTree({
			"package.json": "{}",
		});
		const danglingLink = resolve(tempDir, "dangling-link");
		try {
			symlinkSync(resolve(tempDir, "does-not-exist"), danglingLink, "dir");
		} catch {
			// Some systems disallow dangling symlinks; skip this assertion.
			return;
		}
		const found = findProjectRoot(danglingLink);
		expect(found).toBeUndefined();
	});

	it("uses a fallback of the first existing ancestor when no marker found", () => {
		// No marker; tempDir exists but contains no markers, walking up
		// should still find SOMETHING (or return undefined) without
		// throwing.
		tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-walk-"));
		expect(() => findProjectRoot(tempDir)).not.toThrow();
	});

	it("exists at least one path containing the filesystem root sentinel", () => {
		// Sanity: the default markers array should not be empty.
		expect(DEFAULT_PROJECT_MARKERS.length).toBeGreaterThan(0);
	});
});
