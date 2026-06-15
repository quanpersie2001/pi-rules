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

/**
 * Pre-populate the active-runs file so the maintainer service sees the
 * concurrency slot as taken. This routes the next `startOrQueue` call
 * through `enqueue` instead of `spawn`, avoiding any real `pi` process
 * spawn during tests.
 */
function saturateActiveRuns(projectDir: string, count: number): void {
	const dir = resolve(projectDir, ".pi/.pi-rules");
	mkdirSync(dir, { recursive: true });
	const runs = Array.from({ length: count }, (_, index) => ({
		id: `saturated-${index}`,
		pid: 99_000 + index,
		startedAt: Date.now(),
		batchId: `b-${index}`,
		paths: ["src/seed.ts"],
		protectedScopes: ["**/*"],
		logPath: "/tmp/log",
	}));
	writeFileSync(resolve(dir, "active-runs.json"), JSON.stringify({ version: 1, runs }));
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

	it("pi-rules:maintain with no args notifies a usage warning", async () => {
		const projectDir = makeTempProject("maintain-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintain", "", ctx);
		await harness.invokeCommand("pi-rules:maintain", "   ", ctx);

		expect(harness.notifications).toHaveLength(2);
		expect(harness.notifications[0]?.severity).toBe("warning");
		expect(harness.notifications[0]?.message).toMatch(/Usage:/);
		expect(harness.notifications[0]?.message).toContain("/pi-rules:maintain");
		expect(harness.notifications[1]?.severity).toBe("warning");
	});

	it("pi-rules:maintain with valid args enqueues when concurrency is saturated", async () => {
		const projectDir = makeTempProject("maintain-queue");
		// Default concurrency is 1, so a single active run saturates it.
		saturateActiveRuns(projectDir, 1);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintain", "src/foo.ts src/bar.ts", ctx);

		// The handler should have notified the queued message.
		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toMatch(/^Queued /);
		expect(harness.notifications[0]?.message).toMatch(/\(2 paths\)$/);

		// The queue.json should now contain the batch with both paths.
		const { readFileSync } = await import("node:fs");
		const queueContent = readFileSync(resolve(projectDir, ".pi/.pi-rules/queue.json"), "utf8");
		const queue = JSON.parse(queueContent) as { batches: Array<{ paths: string[] }> };
		expect(queue.batches).toHaveLength(1);
		expect(queue.batches[0]?.paths).toEqual(["src/bar.ts", "src/foo.ts"]);
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
		expect(message).toContain("Rule files: 1");
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

	it("pi-rules:maintainer-status reports empty queue and runs", async () => {
		const projectDir = makeTempProject("ms-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintainer-status", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		const message = harness.notifications[0]?.message ?? "";
		expect(message).toContain("Active runs: 0");
		expect(message).toContain("Queue length: 0");
		expect(message).toContain("Lock: none");
	});

	it("pi-rules:maintainer-log reports empty log when no log file exists", async () => {
		const projectDir = makeTempProject("ml-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintainer-log", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("info");
		expect(harness.notifications[0]?.message).toBe("Maintainer log is empty.");
	});

	it("pi-rules:maintainer-log tail the log when one exists", async () => {
		const projectDir = makeTempProject("ml-tail");
		const piDir = resolve(projectDir, ".pi/.pi-rules");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			resolve(piDir, "maintainer.log"),
			"[2024-01-01T00:00:00Z] line one\n[2024-01-01T00:00:01Z] line two\n[2024-01-01T00:00:02Z] line three\n",
		);

		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintainer-log", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		const message = harness.notifications[0]?.message ?? "";
		expect(message).toContain("line one");
		expect(message).toContain("line two");
		expect(message).toContain("line three");
	});

	it("pi-rules:maintainer-kill with no active runs notifies a warning", async () => {
		const projectDir = makeTempProject("mk-empty");
		const harness = createFakePi();
		piRulesExtension(harness.pi);
		const ctx = harness.makeCommandCtx({ cwd: projectDir });

		await harness.invokeCommand("pi-rules:maintainer-kill", "", ctx);

		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.severity).toBe("warning");
		expect(harness.notifications[0]?.message).toBe("No active maintainer run.");
	});
});
