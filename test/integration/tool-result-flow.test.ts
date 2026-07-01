import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

const tempDirs: string[] = [];

function makeTempProject(label: string): string {
	const dir = mkdtempSync(resolve(tmpdir(), `pi-rules-tool-${label}-`));
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

describe("tool_result flow integration", () => {
	it("injects dynamic rules on a read tool that matches a scoped rule", async () => {
		const projectDir = makeTempProject("read-scoped");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/handler.ts" },
				content: [{ type: "text", text: "file contents" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { content: Array<{ type: string; text?: string }> };
		// The original content is preserved and a new text block with the rule is appended.
		expect(resultObj.content[0]).toEqual({ type: "text", text: "file contents" });
		const appended = resultObj.content[1];
		expect(appended?.type).toBe("text");
		expect(appended?.text).toContain("TS body");
		expect(appended?.text).toContain("## Rule: .pi/rules/typescript.md");
	});

	it("does not inject when the tool path matches no rules", async () => {
		const projectDir = makeTempProject("read-nomatch");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "docs/readme.md" },
				content: [{ type: "text", text: "docs" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("skips injection for errored tool results", async () => {
		const projectDir = makeTempProject("read-error");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/handler.ts" },
				content: [{ type: "text", text: "ENOENT" }],
				details: undefined,
				isError: true,
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("skips dynamic injection when mode is static", async () => {
		const projectDir = makeTempProject("mode-static");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		harness.flagValues.set("pi-rules-mode", "static");
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/handler.ts" },
				content: [{ type: "text", text: "ok" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("skips dynamic injection when dynamic injection is off but still tracks read paths", async () => {
		const projectDir = makeTempProject("dynamic-off");
		writeFileSync(resolve(projectDir, ".pi/pi-rules.json"), JSON.stringify({ dynamicInjection: "off" }));
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const dynamicResult = await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/handler.ts" },
				content: [{ type: "text", text: "ok" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);
		expect(dynamicResult).toBeUndefined();

		const staticResult = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(staticResult).toBeDefined();
		const resultObj = staticResult as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("TS body");
	});

	it("blocks edit when write guard finds a guarded rule that was not injected", async () => {
		const projectDir = makeTempProject("write-guard");
		writeFileSync(resolve(projectDir, ".pi/pi-rules.json"), JSON.stringify({ writeGuardEnabled: true }));
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
guard: true
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const result = await harness.emit(
			"tool_call",
			{
				type: "tool_call",
				toolCallId: "tc-1",
				toolName: "edit",
				input: { path: "src/handler.ts", edits: [{ oldText: "a", newText: "b" }] },
			},
			ctx,
		);

		expect(result).toEqual(
			expect.objectContaining({
				block: true,
			}),
		);
		const resultObj = result as { reason: string };
		expect(resultObj.reason).toContain("Blocked by pi-rules write guard");
		expect(resultObj.reason).toContain("TS body");
	});

	it("allows guarded edit after the rule was injected once by write guard", async () => {
		const projectDir = makeTempProject("write-guard-dedup");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
guard: true
---
# TS body`,
		);

		const harness = createFakePi();
		harness.flagValues.set("pi-rules-write-guard", true);
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const event = {
			type: "tool_call",
			toolCallId: "tc-1",
			toolName: "edit",
			input: { path: "src/handler.ts", edits: [{ oldText: "a", newText: "b" }] },
		};
		expect(await harness.emit("tool_call", event, ctx)).toBeDefined();
		expect(await harness.emit("tool_call", { ...event, toolCallId: "tc-2" }, ctx)).toBeUndefined();
	});

	it("tracks read tool paths in recentReadPaths so a subsequent before_agent_start injects context", async () => {
		const projectDir = makeTempProject("read-then-inject");
		writeFileSync(
			resolve(projectDir, ".pi/rules/typescript.md"),
			`---
paths:
  - "src/**/*.ts"
summary: TS guidance
---
# TS body`,
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		await harness.emit(
			"tool_result",
			{
				type: "tool_result",
				toolCallId: "tc-1",
				toolName: "read",
				input: { path: "src/handler.ts" },
				content: [{ type: "text", text: "ok" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		// After a tool_result, the read path is tracked. Even with an empty prompt,
		// a before_agent_start should match the rule for the tracked path.
		const result = await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);

		expect(result).toBeDefined();
		const resultObj = result as { systemPrompt: string };
		expect(resultObj.systemPrompt).toContain("TS body");
	});
});
