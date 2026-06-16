import { resolve } from "node:path";
import { appendTextFile, ensureDirectory, readJsonFile, readTextFile, writeJsonFile } from "../shared/fs.js";
import { createId } from "../shared/id.js";
import { now, toIsoDate } from "../shared/time.js";
import type { Recommendation, RecommendationsState } from "./recommendation-types.js";

const STATE_VERSION = 1;

const COMPLETED_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class RecommendationStore {
	constructor(private readonly projectRoot: string) {}

	get stateDir(): string {
		return resolve(this.projectRoot, ".pi/.pi-rules");
	}

	get recommendationsPath(): string {
		return resolve(this.stateDir, "recommendations.json");
	}

	get logPath(): string {
		return resolve(this.stateDir, "maintainer.log");
	}

	async initialize(): Promise<void> {
		await ensureDirectory(this.stateDir);
		const state = await this.readState();
		await this.writeState(state);
	}

	async readState(): Promise<RecommendationsState> {
		return readJsonFile<RecommendationsState>(this.recommendationsPath, {
			version: STATE_VERSION,
			recommendations: [],
		});
	}

	async writeState(state: RecommendationsState): Promise<void> {
		await writeJsonFile(this.recommendationsPath, state);
	}

	async getAll(): Promise<Recommendation[]> {
		const state = await this.readState();
		return state.recommendations;
	}

	async getPending(): Promise<Recommendation[]> {
		const state = await this.readState();
		return state.recommendations.filter((rec) => rec.status === "pending");
	}

	async getById(id: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		return state.recommendations.find((rec) => rec.id === id);
	}

	async getByRulePath(rulePath: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		return state.recommendations.find((rec) => rec.rulePath === rulePath && rec.status === "pending");
	}

	async create(rec: Omit<Recommendation, "id" | "createdAt" | "updatedAt" | "mergeCount">): Promise<Recommendation> {
		const state = await this.readState();
		const recommendation: Recommendation = {
			...rec,
			id: createId("rec"),
			createdAt: now(),
			updatedAt: now(),
			mergeCount: 1,
		};
		state.recommendations.push(recommendation);
		await this.writeState(state);
		await this.log(`Created recommendation ${recommendation.id} for ${rec.ruleRelativePath}`);
		return recommendation;
	}

	async merge(rulePath: string, newChangedFiles: string[]): Promise<Recommendation | undefined> {
		const state = await this.readState();
		const rec = state.recommendations.find((r) => r.rulePath === rulePath && r.status === "pending");
		if (rec === undefined) {
			return undefined;
		}
		const existingFiles = new Set(rec.changedFiles);
		for (const file of newChangedFiles) {
			existingFiles.add(file);
		}
		rec.changedFiles = [...existingFiles].sort((left, right) => left.localeCompare(right));
		rec.updatedAt = now();
		rec.mergeCount += 1;
		await this.writeState(state);
		await this.log(`Merged ${newChangedFiles.length} files into ${rec.id} (total: ${rec.changedFiles.length})`);
		return rec;
	}

	async approve(id: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		const rec = state.recommendations.find((r) => r.id === id);
		if (rec === undefined || rec.status !== "pending") {
			return undefined;
		}
		rec.status = "approved";
		rec.approvedAt = now();
		await this.writeState(state);
		await this.log(`Approved recommendation ${rec.id} for ${rec.ruleRelativePath}`);
		return rec;
	}

	async cancel(id: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		const rec = state.recommendations.find((r) => r.id === id);
		if (rec === undefined || rec.status !== "pending") {
			return undefined;
		}
		rec.status = "cancelled";
		await this.writeState(state);
		await this.log(`Cancelled recommendation ${rec.id} for ${rec.ruleRelativePath}`);
		return rec;
	}

	async markCompleted(id: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		const rec = state.recommendations.find((r) => r.id === id);
		if (rec === undefined) {
			return undefined;
		}
		rec.status = "completed";
		rec.completedAt = now();
		await this.writeState(state);
		await this.log(`Completed recommendation ${rec.id} for ${rec.ruleRelativePath}`);
		return rec;
	}

	async markError(id: string, error: string): Promise<Recommendation | undefined> {
		const state = await this.readState();
		const rec = state.recommendations.find((r) => r.id === id);
		if (rec === undefined) {
			return undefined;
		}
		rec.status = "error";
		rec.error = error;
		await this.writeState(state);
		await this.log(`Error in recommendation ${rec.id}: ${error}`);
		return rec;
	}

	async removeCompleted(maxAgeMs: number = COMPLETED_CLEANUP_AGE_MS): Promise<number> {
		const state = await this.readState();
		const cutoff = now() - maxAgeMs;
		const before = state.recommendations.length;
		state.recommendations = state.recommendations.filter((rec) => {
			if (rec.status !== "completed" && rec.status !== "error") {
				return true;
			}
			const completedAt = rec.completedAt ?? rec.updatedAt;
			return completedAt > cutoff;
		});
		const removed = before - state.recommendations.length;
		if (removed > 0) {
			await this.writeState(state);
			await this.log(`Removed ${removed} old completed/error recommendations`);
		}
		return removed;
	}

	async getStats(): Promise<Record<string, number>> {
		const state = await this.readState();
		const stats: Record<string, number> = {
			pending: 0,
			approved: 0,
			cancelled: 0,
			completed: 0,
			error: 0,
		};
		for (const rec of state.recommendations) {
			stats[rec.status] = (stats[rec.status] ?? 0) + 1;
		}
		return stats;
	}

	async log(message: string): Promise<void> {
		await appendTextFile(this.logPath, `[${toIsoDate()}] ${message}\n`);
	}

	async readLogTail(lineCount: number): Promise<string> {
		const content = await readTextFile(this.logPath);
		if (content === undefined) {
			return "";
		}
		return content.split(/\r?\n/).slice(-lineCount).join("\n");
	}
}
