import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RulesEngine } from "../../extension-src/pi-rules/domain/engine.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-engine-test-"));
	mkdirSync(resolve(tempDir, ".pi/rules"), { recursive: true });
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("RulesEngine", () => {
	it("loads rules from .pi/rules/", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: Global
---
# Global`,
		);
		writeFileSync(
			resolve(projectDir, ".pi/rules/scoped.md"),
			`---
paths:
  - "src/**/*.ts"
summary: Scoped
---
# Scoped`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const loaded = await engine.loadRules(projectDir);
		expect(loaded.rules).toHaveLength(2);
		expect(loaded.diagnostics).toHaveLength(0);
	});

	it("caches results and reloads on force", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/a.md"), "---\n---\n# A");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const first = await engine.loadRules(projectDir);
		expect(first.rules).toHaveLength(1);

		writeFileSync(resolve(projectDir, ".pi/rules/b.md"), "---\n---\n# B");
		const second = await engine.loadRules(projectDir, false);
		expect(second.rules).toHaveLength(1); // cache hit

		const third = await engine.loadRules(projectDir, true);
		expect(third.rules).toHaveLength(2); // reloaded
	});

	it("matches rules for paths", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: Global
---
# Global`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const result = await engine.matchRulesForPaths(projectDir, ["any/file.ts"]);
		expect(result.matches).toHaveLength(1);
		expect(result.prompt).toContain("Global");
		expect(result.truncated).toBe(false);
	});

	it("records injection for context tracking", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/g.md"),
			`---
alwaysApply: true
summary: G
---
# G`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const context = await engine.matchRulesForPaths(projectDir, ["f.ts"]);
		const record = engine.recordInjection(["f.ts"], context);
		expect(record.targetPaths).toEqual(["f.ts"]);
		expect(record.rules).toHaveLength(1);
		expect(record.truncated).toBe(false);

		const last = engine.getLastContext();
		expect(last?.targetPaths).toEqual(["f.ts"]);
	});

	it("returns status", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		const status = await engine.getStatus(projectDir);
		expect(status.ruleCount).toBe(1);
		expect(status.projectRoot).toBe(projectDir);
	});

	it("clears cache", async () => {
		const projectDir = makeTempProject();
		writeFileSync(resolve(projectDir, ".pi/rules/g.md"), "---\n---\n# G");

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		await engine.loadRules(projectDir);
		engine.clearCache();

		// Should reload from disk now
		const loaded = await engine.loadRules(projectDir);
		expect(loaded.rules).toHaveLength(1);
	});
});
