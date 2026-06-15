import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RulesEngine } from "../../extension-src/pi-rules/domain/engine.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-dedup-test-"));
	mkdirSync(resolve(tempDir, ".pi/rules"), { recursive: true });
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("RulesEngine context file dedup", () => {
	it("matchRulesForPathsStatic skips rules matching context file real paths", async () => {
		const projectDir = makeTempProject();
		const rulePath = resolve(projectDir, ".pi/rules/general.md");
		writeFileSync(
			rulePath,
			`---
alwaysApply: true
summary: General
---
# General`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		// Simulate AGENTS.md being loaded as a rule (rulePath matches a context file)
		const contextFilePaths = new Set([rulePath]);
		const result = await engine.matchRulesForPathsStatic(projectDir, ["any/file.ts"], contextFilePaths);
		expect(result.matches).toHaveLength(0);
		expect(result.prompt).toBe("");
	});

	it("matchRulesForPathsStatic does not skip rules not in context files", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: General
---
# General`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });
		// Context files set is empty, rule should be injected
		const result = await engine.matchRulesForPathsStatic(projectDir, ["any/file.ts"], new Set());
		expect(result.matches).toHaveLength(1);
		expect(result.prompt).toContain("General");
	});
});

describe("RulesEngine injection dedup", () => {
	it("matchRulesForPathsStatic skips already-injected rules within the same turn", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: General
---
# General`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });

		// First call — rule should match
		const first = await engine.matchRulesForPathsStatic(projectDir, ["any/file.ts"], new Set());
		expect(first.matches).toHaveLength(1);
		engine.markStaticInjectedBatch(first.matches);

		// Second call — rule should be skipped (already injected this turn)
		const second = await engine.matchRulesForPathsStatic(projectDir, ["other/file.ts"], new Set());
		expect(second.matches).toHaveLength(0);
	});

	it("resetTurn clears injection dedup state", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: General
---
# General`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });

		// Inject once
		const first = await engine.matchRulesForPathsStatic(projectDir, ["any/file.ts"], new Set());
		engine.markStaticInjectedBatch(first.matches);

		// Reset turn
		engine.resetTurn();

		// Rule should be injectable again
		const second = await engine.matchRulesForPathsStatic(projectDir, ["any/file.ts"], new Set());
		expect(second.matches).toHaveLength(1);
	});

	it("dynamic injection dedup works across multiple targets", async () => {
		const projectDir = makeTempProject();
		writeFileSync(
			resolve(projectDir, ".pi/rules/scoped.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TypeScript rules
---
# TS Rules`,
		);

		const engine = new RulesEngine({ maxRuleChars: 12_000, maxContextChars: 40_000 });

		// Inject for first target
		const first = await engine.matchRulesForPathsDynamic(projectDir, ["src/a.ts"]);
		expect(first.matches).toHaveLength(1);
		engine.markDynamicInjectedBatch("src/a.ts", first.matches);

		// Same target — should skip
		const second = await engine.matchRulesForPathsDynamic(projectDir, ["src/a.ts"]);
		expect(second.matches).toHaveLength(0);

		// Different target — should inject (dynamic dedup is per-scope-key)
		const third = await engine.matchRulesForPathsDynamic(projectDir, ["src/b.ts"]);
		expect(third.matches).toHaveLength(1);
	});
});
