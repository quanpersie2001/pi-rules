import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createId } from "../shared/id.js";
import { now } from "../shared/time.js";
import type { MaintenanceQueue } from "./maintenance-queue.js";
import type { ActiveMaintenanceRun } from "./maintenance-types.js";

export interface MaintainerRunResult {
	run?: ActiveMaintenanceRun;
	queued: boolean;
	message: string;
}

export class MaintainerService {
	constructor(
		private readonly projectRoot: string,
		private readonly queue: MaintenanceQueue,
		private readonly concurrency: number,
	) {}

	async startOrQueue(paths: string[], reason: string): Promise<MaintainerRunResult> {
		await this.queue.initialize();
		const activeRuns = await this.queue.readActiveRuns();
		if (activeRuns.runs.length >= this.concurrency) {
			const batch = await this.queue.enqueue(paths, reason);
			return { queued: true, message: `Queued ${batch.id} (${batch.paths.length} paths)` };
		}

		const run = await this.spawnRun(paths, reason);
		return { queued: false, run, message: `Started ${run.id} (${run.paths.length} paths)` };
	}

	async startNextQueuedBatch(): Promise<ActiveMaintenanceRun | undefined> {
		await this.queue.initialize();
		const activeRuns = await this.queue.readActiveRuns();
		if (activeRuns.runs.length >= this.concurrency) {
			return undefined;
		}
		const batch = await this.queue.dequeue();
		if (batch === undefined) {
			return undefined;
		}
		return this.spawnRun(batch.paths, batch.reason, batch.id);
	}

	async killRun(runId: string): Promise<boolean> {
		const activeRuns = await this.queue.readActiveRuns();
		const run = activeRuns.runs.find((activeRun) => activeRun.id === runId);
		if (run === undefined) {
			return false;
		}
		try {
			process.kill(run.pid, "SIGTERM");
			await this.queue.log(`Killed ${run.id} (pid ${run.pid})`);
		} catch {
			await this.queue.log(`Failed to kill ${run.id} (pid ${run.pid})`);
		}
		await this.queue.removeActiveRun(runId);
		return true;
	}

	private async spawnRun(paths: string[], reason: string, batchId = createId("batch")): Promise<ActiveMaintenanceRun> {
		const runId = createId("run");
		const skillPath = resolve(this.projectRoot, "skills/rules-maintainer");
		const prompt = `Run rules maintenance for changed paths: ${paths.join(", ")}`;
		const child = spawn("pi", ["-p", "--skill", skillPath, prompt], {
			cwd: this.projectRoot,
			stdio: "ignore",
			detached: true,
		});
		child.unref();

		const run: ActiveMaintenanceRun = {
			id: runId,
			pid: child.pid ?? -1,
			startedAt: now(),
			batchId,
			paths,
			protectedScopes: ["**/*"],
			logPath: this.queue.logPath,
		};
		await this.queue.addActiveRun(run);
		await this.queue.log(`Started ${run.id} (${reason}) for ${paths.join(", ")}`);
		return run;
	}
}
