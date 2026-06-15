import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

const tempDirs: string[] = [];

function makeTempProject(label: string): string {
	const dir = mkdtempSync(resolve(tmpdir(), `pi-rules-session-${label}-`));
	mkdirSync(resolve(dir, ".pi/rules"), { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe("session flow integration", () => {
	it("loads rules on session_start and surfaces status + widget", async () => {
		const projectDir = makeTempProject("status");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: Global
---
# Global body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const status = harness.statuses.get("pi-rules");
		expect(status, "session_start should set the pi-rules status").toBeDefined();
		expect(status?.text).toContain("[pi-rules]");
		expect(status?.text).toContain("1 active");

		const widget = harness.widgets.get("pi-rules");
		expect(widget, "session_start should set the pi-rules widget").toBeDefined();
		expect(widget?.content).toBeInstanceOf(Array);
		const lines = widget?.content as string[];
		// First line is a horizontal border; the title is at index 1.
		expect(lines.length).toBeGreaterThanOrEqual(2);
		expect(lines[0]).toMatch(/^─+$/);
		expect(lines[1]).toContain("[pi-rules]");
		expect(lines[1]).toContain("1 active rules");
	});

	it("injects always-apply rules into the system prompt on before_agent_start", async () => {
		const projectDir = makeTempProject("inject-always");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: G
---
# G body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		harness.statuses.clear();
		harness.widgets.clear();

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "edit src/foo.ts",
				systemPrompt: "You are a helpful assistant.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("You are a helpful assistant.");
		expect(resultObj.systemPrompt).toContain("G body");
		// The rule's relative path is the full .pi/rules/... path.
		expect(resultObj.systemPrompt).toContain("## Rule: .pi/rules/global.md");
	});

	it("injects scoped rules when the prompt references a matching path", async () => {
		const projectDir = makeTempProject("inject-scoped");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TypeScript guidance
---
# TS Body`,
		);
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: Always
---
# General Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix src/api/handler.ts",
				systemPrompt: "Base prompt.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("TS Body");
		expect(resultObj.systemPrompt).toContain("## Rule: .pi/rules/typescript.md");
	});

	it("does not inject when no rules match and there are no always-apply rules", async () => {
		const projectDir = makeTempProject("no-inject");
		writeFileSync(
			resolve(projectDir, ".pi/rules/scoped.md"),
			`---
paths:
  - "docs/**/*.md"
summary: Docs
---
# Docs body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix src/handler.ts",
				systemPrompt: "Base prompt.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("respects pi-rules-disabled flag and skips injection", async () => {
		const projectDir = makeTempProject("disabled");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: G
---
# G body`,
		);

		const harness = createFakePi();
		// Override the default before the extension reads it.
		harness.flagValues.set("pi-rules-disabled", true);
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "edit src/foo.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("respects pi-rules-mode=off and skips injection", async () => {
		const projectDir = makeTempProject("mode-off");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: G
---
# G body`,
		);

		const harness = createFakePi();
		harness.flagValues.set("pi-rules-mode", "off");
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "edit src/foo.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("agent_start clears the status/widget when widget is disabled", async () => {
		const projectDir = makeTempProject("widget-off");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: G
---
# G body`,
		);

		const harness = createFakePi();
		harness.flagValues.set("pi-rules-widget", false);
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		// After session_start with widget disabled, status and widget should be cleared (undefined).
		expect(harness.statuses.get("pi-rules")?.text).toBeUndefined();
		expect(harness.widgets.get("pi-rules")?.content).toBeUndefined();
	});

	it("preserves sessionHotPaths across agent_start so cross-turn matching still works", async () => {
		// Simulates the post-compact scenario: a tool was touched in the
		// previous turn, the user gives a path-less prompt in the next turn,
		// and the rule for the previously-touched path should still inject.
		const projectDir = makeTempProject("session-hot-paths");
		writeFileSync(
			resolve(projectDir, ".pi/rules/auth.md"),
			`---
paths:
  - "src/auth/**/*.ts"
summary: Auth
---
# Auth Body`,
		);
		writeFileSync(
			resolve(projectDir, ".pi/rules/general.md"),
			`---
alwaysApply: true
summary: General
---
# General Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		// Turn 1: user mentions src/auth/login.ts → both rules inject
		await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix src/auth/login.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		// Simulate the LLM reading src/auth/login.ts (populates sessionHotPaths)
		await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/auth/login.ts" },
				content: [{ type: "text", text: "code" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		// Turn 2 boundary: agent_start clears recent paths but preserves sessionHotPaths
		await harness.emit("agent_start", { type: "agent_start" }, ctx);

		// Turn 2: user gives a path-less prompt. Without sessionHotPaths, only
		// the always-apply rule would inject. With it, the auth rule still injects.
		const result2 = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix the failing test",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result2).toBeDefined();
		const resultObj = result2 as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("Auth Body");
		expect(resultObj.systemPrompt).toContain("General Body");
	});

	it("falls back to lastContext.targetPaths when the current turn has no path signals", async () => {
		// Even without any tool activity, if a previous injection happened with
		// a non-empty target set, the next turn's path-less prompt should still
		// re-inject the same rules.
		const projectDir = makeTempProject("lastcontext-fallback");
		writeFileSync(
			resolve(projectDir, ".pi/rules/auth.md"),
			`---
paths:
  - "src/auth/**/*.ts"
summary: Auth
---
# Auth Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		// Turn 1: user mentions the auth path → inject happens, lastContext captured.
		await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix src/auth/login.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		// session_compact fires (simulated) — clears engine cache and recent state,
		// but preserves lastContext via syncRuntime.
		await harness.emit("session_compact", { type: "session_compact" }, ctx);
		await harness.emit("agent_start", { type: "agent_start" }, ctx);

		// Turn 2 (post-compact): user gives a path-less prompt with NO tool history.
		// Without the fallback, the auth rule would not inject.
		const result2 = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "continue please",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result2).toBeDefined();
		const resultObj = result2 as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("Auth Body");
	});

	it("matches rules via trigger phrases in prompt", async () => {
		const projectDir = makeTempProject("trigger-match");
		writeFileSync(
			resolve(projectDir, ".pi/rules/auth.md"),
			`---
triggers:
  - "fix auth"
  - "authentication bug"
summary: Auth rules
---
# Auth Trigger Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "please fix auth login issue",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("Auth Trigger Body");
		expect(resultObj.systemPrompt).toContain('trigger: "fix auth"');
	});

	it("skips non-alwaysApply rules for non-code prompts", async () => {
		const projectDir = makeTempProject("prompt-filter");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: Global
---
# Global Body`,
		);
		writeFileSync(
			resolve(projectDir, ".pi/rules/auth.md"),
			`---
paths:
  - "src/auth/**/*.ts"
summary: Auth
---
# Auth Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		// Non-code prompt: should only inject alwaysApply rules
		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "what is React?",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("Global Body");
		expect(resultObj.systemPrompt).not.toContain("Auth Body");
	});

	it("injects all matching rules for code-related prompts", async () => {
		const projectDir = makeTempProject("code-prompt");
		writeFileSync(
			resolve(projectDir, ".pi/rules/global.md"),
			`---
alwaysApply: true
summary: Global
---
# Global Body`,
		);
		writeFileSync(
			resolve(projectDir, ".pi/rules/auth.md"),
			`---
paths:
  - "src/auth/**/*.ts"
summary: Auth
---
# Auth Body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		// Code-related prompt: should inject both rules
		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "fix the bug in src/auth/login.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("Global Body");
		expect(resultObj.systemPrompt).toContain("Auth Body");
	});
});
