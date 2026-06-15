import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRuleFiles } from "../../extension-src/pi-rules/domain/scanner.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-test-"));
	mkdirSync(resolve(tempDir, ".pi/rules"), { recursive: true });
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("scanRuleFiles", () => {
	it("discovers .md files under .pi/rules/", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/general.md"), "# General");
		writeFileSync(resolve(projectDir, ".pi/rules/project.md"), "# Project");

		const result = await scanRuleFiles(projectDir);
		expect(result.ruleFiles).toHaveLength(2);
		expect(result.ruleFiles.map((f) => f.relativePath).sort()).toEqual([
			".pi/rules/general.md",
			".pi/rules/project.md",
		]);
	});

	it("ignores .pi/.pi-rules/ state directory", async () => {
		const projectDir = makeTempProject();
		mkdirSync(resolve(projectDir, ".pi/.pi-rules"), { recursive: true });
		writeFileSync(resolve(projectDir, ".pi/.pi-rules/state.md"), "# State");
		writeFileSync(resolve(projectDir, ".pi/rules/general.md"), "# General");

		const result = await scanRuleFiles(projectDir);
		expect(result.ruleFiles).toHaveLength(1);
		expect(result.ruleFiles[0].relativePath).toBe(".pi/rules/general.md");
	});

	it("handles missing .pi/rules/ directory", async () => {
		const projectDir = mkdtempSync(resolve(tmpdir(), "pi-rules-test-empty-"));

		const result = await scanRuleFiles(projectDir);
		expect(result.ruleFiles).toHaveLength(0);

		rmSync(projectDir, { recursive: true, force: true });
	});

	it("discovers nested rules in subdirectories", async () => {
		const projectDir = makeTempProject();
		mkdirSync(resolve(projectDir, ".pi/rules/domain"), { recursive: true });
		writeFileSync(resolve(projectDir, ".pi/rules/general.md"), "# General");
		writeFileSync(resolve(projectDir, ".pi/rules/domain/modules.md"), "# Modules");

		const result = await scanRuleFiles(projectDir);
		expect(result.ruleFiles).toHaveLength(2);
		expect(result.ruleFiles.map((f) => f.relativePath).sort()).toEqual([
			".pi/rules/domain/modules.md",
			".pi/rules/general.md",
		]);
	});
});
