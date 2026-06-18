import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

const tempDirs: string[] = [];

function makeTempProject(label: string): string {
	const dir = mkdtempSync(resolve(tmpdir(), `pi-rules-cmd-${label}-`));
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

describe("pi-rules commands", () => {
	it("pi-rules:init sends the init-advanced skill user message when idle", async () => {
		const projectDir = makeTempProject("init");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir, isIdle: () => true });

		await harness.invokeCommand("pi-rules:init", "", ctx);

		expect(harness.userMessages).toHaveLength(1);
		expect(harness.userMessages[0]?.content).toBe("/skill:init-advanced");
	});

	it("pi-rules:init sends as followUp when the agent is busy", async () => {
		const projectDir = makeTempProject("init-busy");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir, isIdle: () => false });

		await harness.invokeCommand("pi-rules:init", "", ctx);

		expect(harness.userMessages).toHaveLength(1);
		expect(harness.userMessages[0]?.content).toBe("/skill:init-advanced");
		expect(harness.userMessages[0]?.options).toEqual({ deliverAs: "followUp" });
	});

	it("pi-rules:init forwards extra args to the skill", async () => {
		const projectDir = makeTempProject("init-args");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir, isIdle: () => true });

		await harness.invokeCommand("pi-rules:init", "Port exactly rule from @.claude/rules", ctx);

		expect(harness.userMessages).toHaveLength(1);
		expect(harness.userMessages[0]?.content).toBe("/skill:init-advanced Port exactly rule from @.claude/rules");
	});

	it("pi-rules:status notifies formatted project status", async () => {
		const projectDir = makeTempProject("status");
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
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		// session_start is what populates the engine cache the status reads from.
		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		harness.notifications.length = 0;

		await harness.invokeCommand("pi-rules:status", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		const message = harness.notifications[0]?.message ?? "";
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(message).toContain("Project root:");
		expect(message).toContain("Rules dir:");
		expect(message).toContain("Rules: 1 files");
		expect(message).toContain("Diagnostics: 0");
		expect(message).toContain("global.md");
	});

	it("pi-rules:context notifies 'no context' before any injection", async () => {
		const projectDir = makeTempProject("context-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:context", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toContain("No pi-rules context");
	});

	it("pi-rules:context reflects the last injection after before_agent_start", async () => {
		const projectDir = makeTempProject("context-after");
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
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		await harness.emit(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: "edit src/foo.ts",
				systemPrompt: "Base.",
				systemPromptOptions: { contextFiles: [] },
			},
			ctx,
		);
		harness.notifications.length = 0;

		await harness.invokeCommand("pi-rules:context", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		const message = harness.notifications[0]?.message ?? "";
		expect(message).toContain("Turn:");
		expect(message).toContain("Targets: src/foo.ts");
		expect(message).toContain("Rules: 1");
		expect(message).toContain("global.md");
	});

	it("pi-rules:approve with no args notifies a usage warning", async () => {
		const projectDir = makeTempProject("approve-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:approve", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("warning");
		expect(harness.notifications[0]?.message).toMatch(/Usage:/);
	});

	it("pi-rules:cancel with no args notifies a usage warning", async () => {
		const projectDir = makeTempProject("cancel-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:cancel", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("warning");
		expect(harness.notifications[0]?.message).toMatch(/Usage:/);
	});

	it("pi-rules:cancel-all with no pending notifies no-op", async () => {
		const projectDir = makeTempProject("cancelall-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:cancel-all", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toBe("No pending recommendations.");
	});

	it("pi-rules:cleanup removes old recommendations", async () => {
		const projectDir = makeTempProject("cleanup");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:cleanup", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toMatch(/Removed \d+ old recommendation/);
	});

	it("pi-rules:recommendations-log reports empty log when no log file exists", async () => {
		const projectDir = makeTempProject("reclog-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:recommendations-log", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toBe("Recommendations log is empty.");
	});
});
