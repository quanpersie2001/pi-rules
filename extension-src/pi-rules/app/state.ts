import type { InjectionRecord } from "../domain/types.js";

/**
 * Maximum number of paths retained in {@link RuntimeState.sessionHotPaths}.
 * The set is FIFO-evicted when the cap is reached so a long session cannot
 * grow the working-set memory without bound.
 */
export const SESSION_HOT_PATHS_MAX = 100;

export interface RuntimeState {
	projectRoot: string;
	/** Paths touched by read/grep/find/ls tool calls within the current turn. Cleared by `resetTurnState`. */
	recentReadPaths: Set<string>;
	/** Paths touched by write/edit/bash tool calls within the current turn. Cleared by `resetTurnState`. */
	recentChangedPaths: Set<string>;
	/**
	 * Across-turn session memory. Paths touched by any tool call in the
	 * current session. Cleared only on session boundary (`resetSessionState`)
	 * so that rule matching survives both turn boundaries and `session_compact`.
	 */
	sessionHotPaths: Set<string>;
	gitStatusBeforeTurn: string;
	lastContext?: InjectionRecord;
}

export function createRuntimeState(projectRoot: string): RuntimeState {
	return {
		projectRoot,
		recentReadPaths: new Set<string>(),
		recentChangedPaths: new Set<string>(),
		sessionHotPaths: new Set<string>(),
		gitStatusBeforeTurn: "",
	};
}

/**
 * Reset only per-turn state. `sessionHotPaths` and `lastContext` are
 * preserved so that rule matching stays coherent across turns and across
 * `session_compact`.
 */
export function resetTurnState(state: RuntimeState): void {
	state.recentReadPaths.clear();
	state.recentChangedPaths.clear();
	state.gitStatusBeforeTurn = "";
}

/**
 * Reset the full runtime state. Called on session boundary (initial
 * `session_start`) to give the extension a clean working set.
 */
export function resetSessionState(state: RuntimeState): void {
	resetTurnState(state);
	state.sessionHotPaths.clear();
	state.lastContext = undefined;
}

/**
 * Add paths to `sessionHotPaths`, evicting the oldest entry (FIFO) when the
 * cap is reached. Re-adding an existing path is a no-op and does not change
 * its position in the insertion order.
 */
export function addSessionHotPaths(state: RuntimeState, paths: Iterable<string>): void {
	for (const path of paths) {
		if (path.length === 0) continue;
		if (state.sessionHotPaths.has(path)) continue;
		if (state.sessionHotPaths.size >= SESSION_HOT_PATHS_MAX) {
			const oldest = state.sessionHotPaths.values().next().value;
			if (oldest !== undefined) state.sessionHotPaths.delete(oldest);
		}
		state.sessionHotPaths.add(path);
	}
}
