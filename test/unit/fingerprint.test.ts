import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RulesEngine } from "../../extension-src/pi-rules/domain/engine.js";
import { scanRuleFiles } from "../../extension-src/pi-rules/domain/scanner.js";
import { fileStatFingerprint } from "../../extension-src/pi-rules/shared/fs.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-fp-test-"));
	mkdirSync(resolve(tempDir, ".pi/rules"), { recursive: true });
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("fileStatFingerprint", () => {
	it("returns a stable fingerprint for unchanged files", () => {
		const projectDir = makeTempProject();
		const filePath = resolve(projectDir, "test.txt");
		writeFileSync(filePath, "hello");

		const fp1 = fileStatFingerprint(filePath);
		const fp2 = fileStatFingerprint(filePath);
		expect(fp1).toBe(fp2);
	});

	it("returns different fingerprint after file modification", () => {
		const projectDir = makeTempProject();
		const filePath = resolve(projectDir, "test.txt");
		writeFileSync(filePath, "hello");

		const fp1 = fileStatFingerprint(filePath);
		writeFileSync(filePath, "hello world");
		const fp2 = fileStatFingerprint(filePath);
		expect(fp1).not.toBe(fp2);
	});

	it("returns 'missing' for non-existent files", () => {
		const fp = fileStatFingerprint("/nonexistent/path/file.md");
		expect(fp).toBe("missing");
	});
});

describe("scanRuleFiles with fingerprints", () => {
	it("includes fingerprint in each RuleFile", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/general.md"), "# General");

		const result = await scanRuleFiles(projectDir);
		expect(result.ruleFiles).toHaveLength(1);
		expect(result.ruleFiles[0].fingerprint).toBeDefined();
		expect(result.ruleFiles[0].fingerprint).not.toBe("missing");
	});
});

describe("RulesEngine fingerprint caching", () => {
	it("fingerprintsMatch returns true after initial load", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\nalwaysApply: true\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		await engine.loadRules(projectDir, true);
		expect(await engine.fingerprintsMatch(projectDir)).toBe(true);
	});

	it("fingerprintsMatch returns false after file modification", async () => {
		const projectDir = makeTempProject();
		const rulePath = resolve(projectDir, ".pi/rules/g.md");
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		await engine.loadRules(projectDir, true);

		// Modify file after loading
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# Modified");

		expect(await engine.fingerprintsMatch(projectDir)).toBe(false);
	});

	it("fingerprintsMatch returns false after new file added", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/a.md"), "---\n---\n# A");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		await engine.loadRules(projectDir, true);

		// Add new file
		writeFileSync(resolve(projectDir, ".pi/rules/b.md"), "---\n---\n# B");

		expect(await engine.fingerprintsMatch(projectDir)).toBe(false);
	});

	it("loadRulesIfUnchanged returns cached result when fingerprints match", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\nalwaysApply: true\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const first = await engine.loadRules(projectDir, true);
		const second = await engine.loadRulesIfUnchanged(projectDir);
		// Should be the same object (cache hit via fingerprint match)
		expect(first).toBe(second);
	});

	it("loadRulesIfUnchanged re-loads when fingerprints change", async () => {
		const projectDir = makeTempProject();
		const rulePath = resolve(projectDir, ".pi/rules/g.md");
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		await engine.loadRules(projectDir, true);

		writeFileSync(rulePath, "---\nalwaysApply: true\n---\n# Modified");
		await engine.loadRulesIfUnchanged(projectDir); // should re-load

		// After re-load, fingerprints should match again
		expect(await engine.fingerprintsMatch(projectDir)).toBe(true);
	});
});
