import { describe, expect, it } from "vitest";
import {
	findProjectRoot,
	isSubPath,
	normalizePath,
	toRelativeProjectPath,
} from "../../extension-src/pi-rules/shared/path.js";

describe("normalizePath", () => {
	it("normalizes backslashes to forward slashes", () => {
		expect(normalizePath("src\\foo\\bar.ts")).toBe("src/foo/bar.ts");
	});

	it("strips leading ./", () => {
		expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
	});

	it("leaves normal paths unchanged", () => {
		expect(normalizePath("src/foo/bar.ts")).toBe("src/foo/bar.ts");
	});
});

describe("isSubPath", () => {
	it("returns true for direct child", () => {
		expect(isSubPath("/root", "/root/child")).toBe(true);
	});

	it("returns true for nested child", () => {
		expect(isSubPath("/root", "/root/a/b/c")).toBe(true);
	});

	it("returns false for sibling path", () => {
		expect(isSubPath("/root", "/other")).toBe(false);
	});

	it("returns false for parent path", () => {
		expect(isSubPath("/root/child", "/root")).toBe(false);
	});
});

describe("toRelativeProjectPath", () => {
	it("returns relative path for absolute path", () => {
		expect(toRelativeProjectPath("/project", "/project/src/foo.ts")).toBe("src/foo.ts");
	});

	it("normalizes the result", () => {
		expect(toRelativeProjectPath("/project", "/project/src\\bar.ts")).toBe("src/bar.ts");
	});
});

describe("findProjectRoot", () => {
	it("finds project root starting from a subdirectory", () => {
		const root = findProjectRoot(process.cwd());
		expect(root).toBeTruthy();
		expect(typeof root).toBe("string");
	});
});
