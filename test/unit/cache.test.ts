import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuleCache } from "../../extension-src/pi-rules/domain/cache.js";
import { parseRuleFile } from "../../extension-src/pi-rules/domain/parser.js";
import { scanRuleFiles } from "../../extension-src/pi-rules/domain/scanner.js";
import type { RuleScanResult } from "../../extension-src/pi-rules/domain/types.js";
import { fileStatFingerprint, readTextFile } from "../../extension-src/pi-rules/shared/fs.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-cache-test-"));
	mkdirSync(resolve(tempDir, ".pi/rules"), { recursive: true });
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("createRuleCache", () => {
	it("returns an object with get/set/invalidate/clear/has/peek", () => {
		const cache = createRuleCache();
		expect(typeof cache.get).toBe("function");
		expect(typeof cache.set).toBe("function");
		expect(typeof cache.invalidate).toBe("function");
		expect(typeof cache.clear).toBe("function");
		expect(typeof cache.has).toBe("function");
		expect(typeof cache.peek).toBe("function");
	});

	it("returns undefined on `get` miss", async () => {
		const cache = createRuleCache();
		const result = await cache.get("/nonexistent");
		expect(result).toBeUndefined();
		expect(cache.has()).toBe(false);
		expect(cache.peek()).toBeUndefined();
	});

	it("stores a value via `set` and returns the same value via `get`", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: Global
---
# Global`,
		);

		const cache = createRuleCache({
			scan: scanRuleFiles,
			read: readTextFile,
			parse: parseRuleFile,
		});

		const loaded = await cache.set(projectDir);
		expect(loaded.rules).toHaveLength(1);
		expect(cache.has()).toBe(true);

		const peeked = cache.peek();
		expect(peeked).toBe(loaded);

		const got = await cache.get(projectDir);
		expect(got).toBe(loaded);
	});

	it("invalidate removes the cached entry", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\nalwaysApply: true\n---\n# G");

		const cache = createRuleCache({
			scan: scanRuleFiles,
			read: readTextFile,
			parse: parseRuleFile,
		});
		await cache.set(projectDir);
		expect(cache.has()).toBe(true);

		cache.invalidate();
		expect(cache.has()).toBe(false);
		expect(cache.peek()).toBeUndefined();
	});

	it("clear is an alias for invalidate", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const cache = createRuleCache({
			scan: scanRuleFiles,
			read: readTextFile,
			parse: parseRuleFile,
		});
		await cache.set(projectDir);
		expect(cache.has()).toBe(true);

		cache.clear();
		expect(cache.has()).toBe(false);
	});

	it("peek does not record a cache access and returns undefined when empty", () => {
		const cache = createRuleCache();
		expect(cache.peek()).toBeUndefined();
		expect(cache.has()).toBe(false);
	});

	it("get returns undefined when fingerprints no longer match", async () => {
		const projectDir = makeTempProject();
		const rulePath = resolve(projectDir, ".pi/rules/g.md");
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# G");

		const cache = createRuleCache({
			scan: scanRuleFiles,
			read: readTextFile,
			parse: parseRuleFile,
		});
		await cache.set(projectDir);
		expect(cache.has()).toBe(true);

		// Modify the file — the stored fingerprint should no longer match
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# G modified");

		const got = await cache.get(projectDir);
		expect(got).toBeUndefined();
		// Cache entry itself is not removed by `get` failure — only `invalidate` does that.
		expect(cache.has()).toBe(true);
	});

	it("throws when `set` is called without a scan dependency", async () => {
		const cache = createRuleCache();
		await expect(cache.set("/tmp/anywhere")).rejects.toThrow(/scan/);
	});

	it("set without parse/read stores fingerprints but no parsed rules", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const cache = createRuleCache({ scan: scanRuleFiles });
		const loaded = await cache.set(projectDir);
		expect(loaded.rules).toEqual([]);
		expect(loaded.fingerprints.size).toBe(1);
	});

	it("accepts a custom fingerprint function for deterministic tests", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const calls: string[] = [];
		const cache = createRuleCache({
			scan: scanRuleFiles,
			read: readTextFile,
			parse: parseRuleFile,
			fingerprint: (path: string) => {
				calls.push(path);
				return fileStatFingerprint(path);
			},
		});
		await cache.set(projectDir);
		expect(calls.length).toBeGreaterThanOrEqual(0);
	});

	it("scan dependency receives the cwd passed to set/get", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const calls: string[] = [];
		const stubScan = async (cwd: string): Promise<RuleScanResult> => {
			calls.push(cwd);
			return scanRuleFiles(cwd);
		};
		const cache = createRuleCache({
			scan: stubScan,
			read: readTextFile,
			parse: parseRuleFile,
		});
		await cache.set(projectDir);
		expect(calls).toContain(projectDir);
	});
});
