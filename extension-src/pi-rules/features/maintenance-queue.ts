import { resolve } from "node:path";
import {
	appendTextFile,
	ensureDirectory,
	readJsonFile,
	readTextFile,
	removeFile,
	writeJsonFile,
} from "../shared/fs.js";
import { createId } from "../shared/id.js";
import { now, toIsoDate } from "../shared/time.js";
import type {
	ActiveMaintenanceRun,
	ActiveRunsState,
	LegacyMaintainerLock,
	MaintenanceBatch,
	MaintenanceQueueState,
} from "./maintenance-types.js";

const QUEUE_VERSION = 1;

export class MaintenanceQueue {
	constructor(private readonly projectRoot: string) {}

	get stateDir(): string {
		return resolve(this.projectRoot, ".pi/.pi-rules");
	}

	get queuePath(): string {
		return resolve(this.stateDir, "queue.json");
	}

	get logPath(): string {
		return resolve(this.stateDir, "maintainer.log");
	}

	get lockPath(): string {
		return resolve(this.stateDir, "maintainer.lock");
	}

	get activeRunsPath(): string {
		return resolve(this.stateDir, "active-runs.json");
	}

	async initialize(): Promise<void> {
		await ensureDirectory(this.stateDir);
		const queue = await this.readQueue();
		await this.writeQueue(queue);
		const activeRuns = await this.readActiveRuns();
		await this.writeActiveRuns(activeRuns);
	}

	async readQueue(): Promise<MaintenanceQueueState> {
		return readJsonFile<MaintenanceQueueState>(this.queuePath, { version: QUEUE_VERSION, batches: [] });
	}

	async writeQueue(state: MaintenanceQueueState): Promise<void> {
		await writeJsonFile(this.queuePath, state);
	}

	async enqueue(paths: string[], reason: string): Promise<MaintenanceBatch> {
		const queue = await this.readQueue();
		const batch: MaintenanceBatch = {
			id: createId("batch"),
			createdAt: now(),
			paths: [...new Set(paths)].sort((left, right) => left.localeCompare(right)),
			reason,
		};
		queue.batches.push(batch);
		await this.writeQueue(queue);
		await this.log(`Enqueued ${batch.id} (${reason}) for ${batch.paths.join(", ")}`);
		return batch;
	}

	async dequeue(): Promise<MaintenanceBatch | undefined> {
		const queue = await this.readQueue();
		const batch = queue.batches.shift();
		await this.writeQueue(queue);
		return batch;
	}

	async peekQueue(): Promise<MaintenanceBatch[]> {
		const queue = await this.readQueue();
		return queue.batches;
	}

	async readActiveRuns(): Promise<ActiveRunsState> {
		return readJsonFile<ActiveRunsState>(this.activeRunsPath, { version: QUEUE_VERSION, runs: [] });
	}

	async writeActiveRuns(state: ActiveRunsState): Promise<void> {
		await writeJsonFile(this.activeRunsPath, state);
	}

	async addActiveRun(run: ActiveMaintenanceRun): Promise<void> {
		const activeRuns = await this.readActiveRuns();
		activeRuns.runs.push(run);
		await this.writeActiveRuns(activeRuns);
		await this.writeLock({ pid: run.pid, runId: run.id, startedAt: run.startedAt });
	}

	async removeActiveRun(runId: string): Promise<void> {
		const activeRuns = await this.readActiveRuns();
		activeRuns.runs = activeRuns.runs.filter((run) => run.id !== runId);
		await this.writeActiveRuns(activeRuns);
		const lock = await this.readLock();
		if (lock?.runId === runId) {
			await this.clearLock();
		}
	}

	async readLock(): Promise<LegacyMaintainerLock | undefined> {
		return readJsonFile<LegacyMaintainerLock | undefined>(this.lockPath, undefined);
	}

	async writeLock(lock: LegacyMaintainerLock): Promise<void> {
		await writeJsonFile(this.lockPath, lock);
	}

	async clearLock(): Promise<void> {
		await removeFile(this.lockPath);
	}

	async readLogTail(lineCount: number): Promise<string> {
		const content = await readTextFile(this.logPath);
		if (content === undefined) {
			return "";
		}
		return content.split(/\r?\n/).slice(-lineCount).join("\n");
	}

	async log(message: string): Promise<void> {
		await appendTextFile(this.logPath, `[${toIsoDate()}] ${message}\n`);
	}
}
