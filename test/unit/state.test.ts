import { describe, expect, it } from "vitest";
import {
	addSessionHotPaths,
	createRuntimeState,
	type RuntimeState,
	resetSessionState,
	resetTurnState,
	SESSION_HOT_PATHS_MAX,
} from "../../extension-src/pi-rules/app/state.js";
import type { InjectionRecord } from "../../extension-src/pi-rules/domain/types.js";

function makeInjection(targetPaths: string[]): InjectionRecord {
	return {
		turnId: "turn_1",
		targetPaths,
		rules: [],
		injectedAt: 0,
		truncated: false,
	};
}

describe("RuntimeState", () => {
	describe("createRuntimeState", () => {
		it("initializes all fields with empty defaults", () => {
			const state = createRuntimeState("/proj");
			expect(state.projectRoot).toBe("/proj");
			expect(state.recentReadPaths).toBeInstanceOf(Set);
			expect(state.recentReadPaths.size).toBe(0);
			expect(state.recentChangedPaths).toBeInstanceOf(Set);
			expect(state.recentChangedPaths.size).toBe(0);
			expect(state.sessionHotPaths).toBeInstanceOf(Set);
			expect(state.sessionHotPaths.size).toBe(0);
			expect(state.gitStatusBeforeTurn).toBe("");
			expect(state.lastContext).toBeUndefined();
		});

		it("returns independent Set instances on each call (no shared mutable state)", () => {
			const left = createRuntimeState("/a");
			const right = createRuntimeState("/b");
			left.sessionHotPaths.add("foo");
			expect(right.sessionHotPaths.has("foo")).toBe(false);
			expect(right.projectRoot).toBe("/b");
		});
	});

	describe("resetTurnState", () => {
		it("clears recentReadPaths, recentChangedPaths, gitStatusBeforeTurn", () => {
			const state = createRuntimeState("/proj");
			state.recentReadPaths.add("a.ts");
			state.recentChangedPaths.add("b.ts");
			state.gitStatusBeforeTurn = "M a.ts";
			resetTurnState(state);
			expect(state.recentReadPaths.size).toBe(0);
			expect(state.recentChangedPaths.size).toBe(0);
			expect(state.gitStatusBeforeTurn).toBe("");
		});

		it("preserves sessionHotPaths (across-turn memory)", () => {
			const state = createRuntimeState("/proj");
			state.sessionHotPaths.add("foo.ts");
			state.sessionHotPaths.add("bar.ts");
			resetTurnState(state);
			expect(state.sessionHotPaths.size).toBe(2);
			expect(state.sessionHotPaths.has("foo.ts")).toBe(true);
			expect(state.sessionHotPaths.has("bar.ts")).toBe(true);
		});

		it("preserves lastContext", () => {
			const state = createRuntimeState("/proj");
			state.lastContext = makeInjection(["foo.ts"]);
			resetTurnState(state);
			expect(state.lastContext).toBeDefined();
			expect(state.lastContext?.targetPaths).toEqual(["foo.ts"]);
		});
	});

	describe("resetSessionState", () => {
		it("clears everything including sessionHotPaths and lastContext", () => {
			const state = createRuntimeState("/proj");
			state.sessionHotPaths.add("a.ts");
			state.sessionHotPaths.add("b.ts");
			state.recentReadPaths.add("c.ts");
			state.recentChangedPaths.add("d.ts");
			state.gitStatusBeforeTurn = "M a.ts";
			state.lastContext = makeInjection(["a.ts"]);
			resetSessionState(state);
			expect(state.sessionHotPaths.size).toBe(0);
			expect(state.recentReadPaths.size).toBe(0);
			expect(state.recentChangedPaths.size).toBe(0);
			expect(state.gitStatusBeforeTurn).toBe("");
			expect(state.lastContext).toBeUndefined();
		});
	});

	describe("addSessionHotPaths", () => {
		it("adds new paths", () => {
			const state = createRuntimeState("/proj");
			addSessionHotPaths(state, ["foo.ts", "bar.ts"]);
			expect(state.sessionHotPaths.size).toBe(2);
			expect(state.sessionHotPaths.has("foo.ts")).toBe(true);
			expect(state.sessionHotPaths.has("bar.ts")).toBe(true);
		});

		it("ignores empty strings", () => {
			const state = createRuntimeState("/proj");
			addSessionHotPaths(state, ["", "foo.ts"]);
			expect(state.sessionHotPaths.size).toBe(1);
			expect(state.sessionHotPaths.has("foo.ts")).toBe(true);
		});

		it("accepts whitespace-only strings (caller is responsible for normalization)", () => {
			const state = createRuntimeState("/proj");
			addSessionHotPaths(state, ["  ", "foo.ts"]);
			// Whitespace is preserved as a literal path — callers normalize upstream.
			expect(state.sessionHotPaths.size).toBe(2);
			expect(state.sessionHotPaths.has("  ")).toBe(true);
		});

		it("does not duplicate existing paths and does not change their position", () => {
			const state = createRuntimeState("/proj");
			addSessionHotPaths(state, ["foo.ts", "bar.ts"]);
			const initialOrder = [...state.sessionHotPaths];
			addSessionHotPaths(state, ["foo.ts", "baz.ts"]);
			expect(state.sessionHotPaths.size).toBe(3);
			// `foo.ts` is still first; `baz.ts` appended.
			expect([...state.sessionHotPaths]).toEqual([...initialOrder, "baz.ts"]);
		});

		it("accepts any iterable, not just arrays", () => {
			const state = createRuntimeState("/proj");
			const set = new Set(["foo.ts", "bar.ts"]);
			addSessionHotPaths(state, set);
			expect(state.sessionHotPaths.size).toBe(2);
		});

		it(`caps at SESSION_HOT_PATHS_MAX (${SESSION_HOT_PATHS_MAX}) with FIFO eviction`, () => {
			const state = createRuntimeState("/proj");
			const initialPaths: string[] = [];
			for (let i = 0; i < SESSION_HOT_PATHS_MAX; i++) {
				initialPaths.push(`file${i}.ts`);
			}
			addSessionHotPaths(state, initialPaths);
			expect(state.sessionHotPaths.size).toBe(SESSION_HOT_PATHS_MAX);

			// Adding a new path evicts the oldest.
			addSessionHotPaths(state, ["newfile.ts"]);
			expect(state.sessionHotPaths.size).toBe(SESSION_HOT_PATHS_MAX);
			expect(state.sessionHotPaths.has("file0.ts")).toBe(false);
			expect(state.sessionHotPaths.has("newfile.ts")).toBe(true);
			// file1..fileN-1 still present.
			expect(state.sessionHotPaths.has("file1.ts")).toBe(true);
			expect(state.sessionHotPaths.has(`file${SESSION_HOT_PATHS_MAX - 1}.ts`)).toBe(true);
		});

		it("re-adding an existing path at cap does not evict (the path is already present)", () => {
			const state = createRuntimeState("/proj");
			const paths: string[] = [];
			for (let i = 0; i < SESSION_HOT_PATHS_MAX; i++) paths.push(`file${i}.ts`);
			addSessionHotPaths(state, paths);
			// re-add file0 (the oldest)
			addSessionHotPaths(state, ["file0.ts"]);
			// size is unchanged, nothing was evicted
			expect(state.sessionHotPaths.size).toBe(SESSION_HOT_PATHS_MAX);
			expect(state.sessionHotPaths.has("file0.ts")).toBe(true);
		});
	});

	describe("RuntimeState is a plain interface — type checks", () => {
		it("accepts lastContext assignment", () => {
			const state: RuntimeState = createRuntimeState("/proj");
			state.lastContext = makeInjection(["x"]);
			expect(state.lastContext?.turnId).toBe("turn_1");
		});
	});
});
