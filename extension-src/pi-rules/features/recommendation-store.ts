import { resolve } from "node:path";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../shared/fs.js";
import { createId } from "../shared/id.js";
import { now } from "../shared/time.js";
import type { Recommendation, RecommendationsState } from "./recommendation-types.js";

const STATE_VERSION = 1;

/**
 * Simple persistent store for rule update recommendations.
 * Stores recommendations in .pi/.pi-rules/recommendations.json.
 * Survives restarts and session switches.
 */
export class RecommendationStore {
	constructor(private readonly projectRoot: string) {}

	get stateDir(): string {
		return resolve(this.projectRoot, ".pi/.pi-rules");
	}

	get recommendationsPath(): string {
		return resolve(this.stateDir, "recommendations.json");
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
		return recommendation;
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
		return rec;
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
}

/**
 * Build a human-readable summary of file extensions in a path list.
 * Example: "15 files: 12 .cs, 2 .csproj, 1 .sln"
 */
export function computeExtensionSummary(paths: string[]): string {
	if (paths.length === 0) return "0 files";

	const extCounts = new Map<string, number>();
	for (const path of paths) {
		const dotIndex = path.lastIndexOf(".");
		const ext = dotIndex > 0 && path.indexOf("/", dotIndex) === -1 ? path.slice(dotIndex) : "(other)";
		extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
	}

	const parts = [...extCounts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([ext, count]) => `${count} ${ext}`);

	return `${paths.length} file${paths.length > 1 ? "s" : ""}: ${parts.join(", ")}`;
}
