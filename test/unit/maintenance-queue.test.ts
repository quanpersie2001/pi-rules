import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaintenanceQueue } from "../../extension-src/pi-rules/features/maintenance-queue.js";

let tempDir = "";

function makeTempProject(): string {
	tempDir = mkdtempSync(resolve(tmpdir(), "pi-rules-queue-test-"));
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("MaintenanceQueue", () => {
	it("initializes state directory", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		// State files should exist after init (or at least not throw)
		const state = await queue.readQueue();
		expect(state.version).toBe(1);
		expect(state.batches).toEqual([]);
	});

	it("enqueues a batch", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		const batch = await queue.enqueue(["src/foo.ts"], "agent_end");
		expect(batch.paths).toEqual(["src/foo.ts"]);
		expect(batch.reason).toBe("agent_end");

		const state = await queue.readQueue();
		expect(state.batches).toHaveLength(1);
	});

	it("dequeues a batch", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		await queue.enqueue(["src/foo.ts"], "test");
		await queue.enqueue(["src/bar.ts"], "test");

		const first = await queue.dequeue();
		expect(first?.paths).toEqual(["src/foo.ts"]);

		const state = await queue.readQueue();
		expect(state.batches).toHaveLength(1);
		expect(state.batches[0].paths).toEqual(["src/bar.ts"]);
	});

	it("peeks at queue", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		await queue.enqueue(["src/a.ts"], "test");
		const batches = await queue.peekQueue();
		expect(batches).toHaveLength(1);
	});

	it("manages active runs", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		await queue.addActiveRun({
			id: "run_1",
			pid: 12345,
			startedAt: Date.now(),
			batchId: "batch_1",
			paths: ["src/foo.ts"],
			protectedScopes: ["src/**/*.ts"],
			logPath: queue.logPath,
		});

		const active = await queue.readActiveRuns();
		expect(active.runs).toHaveLength(1);
		expect(active.runs[0].id).toBe("run_1");

		await queue.removeActiveRun("run_1");
		const active2 = await queue.readActiveRuns();
		expect(active2.runs).toHaveLength(0);
	});

	it("manages legacy lock", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		const lock = { pid: 12345, runId: "run_1", startedAt: Date.now() };
		await queue.writeLock(lock);

		const read = await queue.readLock();
		expect(read?.runId).toBe("run_1");

		await queue.clearLock();
		const cleared = await queue.readLock();
		expect(cleared).toBeUndefined();
	});

	it("reads log tail from empty log", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		const tail = await queue.readLogTail(10);
		expect(tail).toBe("");
	});

	it("appends to log and reads tail", async () => {
		const projectDir = makeTempProject();
		const queue = new MaintenanceQueue(projectDir);
		await queue.initialize();

		await queue.log("First entry");
		await queue.log("Second entry");
		const tail = await queue.readLogTail(10);
		expect(tail).toContain("Second entry");
	});
});
