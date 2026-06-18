import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";
import type { RulesEngine } from "../domain/engine.js";
import { normalizePath } from "../shared/path.js";
import { computeExtensionSummary, type RecommendationStore } from "./recommendation-store.js";
import type { ApplyResult, Recommendation } from "./recommendation-types.js";

export class RecommenderService {
	constructor(
		private readonly projectRoot: string,
		private readonly store: RecommendationStore,
		private readonly engine: RulesEngine,
	) {}

	async recommend(changedPaths: string[], reason: string): Promise<Recommendation[]> {
		await this.store.initialize();
		const normalizedPaths = [...new Set(changedPaths.map((p) => normalizePath(p)))].sort();
		if (normalizedPaths.length === 0) {
			return [];
		}

		const context = await this.engine.matchRulesForPaths(this.projectRoot, normalizedPaths);
		const results: Recommendation[] = [];

		for (const match of context.matches) {
			const ruleAbsPath = match.absolutePath;
			const ruleRelPath = relative(this.projectRoot, ruleAbsPath);
			const existing = await this.store.getByRulePath(ruleAbsPath);

			if (existing !== undefined) {
				const merged = await this.store.merge(ruleAbsPath, normalizedPaths);
				if (merged !== undefined) {
					results.push(merged);
				}
			} else {
				const created = await this.store.create({
					rulePath: ruleAbsPath,
					ruleRelativePath: normalizePath(ruleRelPath),
					changedFiles: normalizedPaths,
					fileCount: normalizedPaths.length,
					extensionSummary: computeExtensionSummary(normalizedPaths),
					reason,
					status: "pending",
				});
				results.push(created);
			}
		}

		return results;
	}

	async apply(id: string): Promise<ApplyResult> {
		await this.store.initialize();
		const rec = await this.store.getById(id);
		if (rec === undefined) {
			return { id, success: false, message: `Recommendation ${id} not found` };
		}
		if (rec.status !== "approved") {
			return { id, success: false, message: `Recommendation ${id} is not approved (status: ${rec.status})` };
		}

		try {
			await this.spawnUpdateAgent(rec);
			await this.store.markCompleted(id);
			return { id, success: true, message: `Updated rule ${rec.ruleRelativePath}` };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			await this.store.markError(id, errorMessage);
			return { id, success: false, message: errorMessage };
		}
	}

	async applyAll(): Promise<ApplyResult[]> {
		await this.store.initialize();
		const approved = (await this.store.getAll()).filter((rec) => rec.status === "approved");
		const results: ApplyResult[] = [];

		for (const rec of approved) {
			results.push(await this.apply(rec.id));
		}

		return results;
	}

	async cleanup(maxAgeMs?: number): Promise<number> {
		await this.store.initialize();
		return this.store.removeCompleted(maxAgeMs);
	}

	private spawnUpdateAgent(rec: Recommendation): Promise<void> {
		return new Promise((resolvePromise, reject) => {
			const skillPath = resolve(this.projectRoot, "skills/rules-maintainer");
			const prompt = [
				`Update the rule file at ${rec.rulePath}`,
				`based on these changed source files: ${rec.changedFiles.join(", ")}.`,
				`The rule applies to paths matching its frontmatter.`,
				`Review the changed files and update the rule content if needed.`,
			].join(" ");

			const child = spawn("pi", ["-p", "--skill", skillPath, prompt], {
				cwd: this.projectRoot,
				stdio: "ignore",
				detached: false,
			});

			let settled = false;

			child.on("close", (code) => {
				if (settled) return;
				settled = true;
				if (code === 0) {
					resolvePromise();
				} else {
					reject(new Error(`Pi agent exited with code ${code}`));
				}
			});

			child.on("error", (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});

			const timeoutMs = 5 * 60 * 1000; // 5 minute timeout
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				try {
					process.kill(child.pid ?? -1, "SIGTERM");
				} catch {
					// ignore
				}
				reject(new Error("Pi agent timed out after 5 minutes"));
			}, timeoutMs);

			child.on("close", () => clearTimeout(timer));
		});
	}
}
