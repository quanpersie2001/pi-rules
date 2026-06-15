import type { PiRulesConfig } from "../app/config.js";
import { createRuntimeState, type RuntimeState } from "../app/state.js";
import { RulesEngine } from "../domain/engine.js";
import { MaintainerService } from "../features/maintainer.js";
import { MaintenanceQueue } from "../features/maintenance-queue.js";
import { findProjectRoot, normalizePath } from "../shared/path.js";

/**
 * Mutable runtime bundle owned by the extension entrypoint. The instance
 * is rebuilt by `syncRuntime` when project root or character limits change,
 * so event handlers and commands must always read it through the current
 * reference rather than capturing the original object.
 */
export interface RuntimeDeps {
	config: PiRulesConfig;
	state: RuntimeState;
	engine: RulesEngine;
	queue: MaintenanceQueue;
	maintainer: MaintainerService;
}

/**
 * Build a fresh runtime bundle for the given cwd and config. Called on
 * initial load and whenever `syncRuntime` detects a structural change.
 */
export function createRuntime(cwd: string, config: PiRulesConfig): RuntimeDeps {
	const projectRoot = findProjectRoot(cwd) ?? cwd;
	const queue = new MaintenanceQueue(projectRoot);
	return {
		config,
		state: createRuntimeState(projectRoot),
		engine: new RulesEngine({
			maxRuleChars: config.maxRuleChars,
			maxContextChars: config.maxContextChars,
		}),
		queue,
		maintainer: new MaintainerService(projectRoot, queue, config.maintainerConcurrency),
	};
}

/**
 * Normalize a user-supplied path and reject anything that escapes the project
 * (absolute paths, parent-relative paths, or empty strings). Shared between
 * event handlers and slash commands.
 */
export function normalizeCandidatePath(path: string): string | undefined {
	const normalized = normalizePath(path);
	if (normalized.length === 0 || normalized.startsWith("..") || normalized.startsWith("/")) {
		return undefined;
	}
	return normalized;
}
