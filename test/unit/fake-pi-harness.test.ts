import { beforeEach, describe, expect, it } from "vitest";
import { createFakePi } from "../helpers/fake-pi-harness.js";

describe("fake-pi-harness", () => {
	let harness: ReturnType<typeof createFakePi>;

	beforeEach(() => {
		harness = createFakePi();
	});

	it("captures pi.on handlers and dispatches them via emit", async () => {
		const received: Array<{ event: unknown; ctx: unknown }> = [];
		harness.pi.on("session_start", (event, ctx) => {
			received.push({ event, ctx });
		});

		expect(harness.handlers).toHaveLength(1);
		expect(harness.handlers[0]?.event).toBe("session_start");

		const ctx = harness.makeCtx();
		const result = await harness.emit("session_start", { type: "session_start", reason: "test" }, ctx);
		expect(received).toHaveLength(1);
		expect(received[0]?.event).toEqual({ type: "session_start", reason: "test" });
		expect(result).toBeUndefined();
	});

	it("round-trips a command registration through invokeCommand", async () => {
		const calls: Array<{ args: string; cwd: string }> = [];
		harness.pi.registerCommand("test:cmd", {
			description: "Test command",
			handler: async (args, ctx) => {
				calls.push({ args, cwd: ctx.cwd });
			},
		});

		expect(harness.commands).toHaveLength(1);
		expect(harness.commands[0]?.name).toBe("test:cmd");
		expect(harness.commands[0]?.options.description).toBe("Test command");

		const ctx = harness.makeCommandCtx({ cwd: "/tmp/proj" });
		await harness.invokeCommand("test:cmd", "arg1 arg2", ctx);
		expect(calls).toEqual([{ args: "arg1 arg2", cwd: "/tmp/proj" }]);
	});

	it("captures tools and invokes them via invokeTool", async () => {
		const calls: Array<{ id: string; params: unknown; ctx: unknown }> = [];
		harness.pi.registerTool({
			name: "test_tool",
			label: "Test Tool",
			description: "Test",
			parameters: {},
			execute: async (toolCallId, params, _signal, _onUpdate, ctx) => {
				calls.push({ id: toolCallId, params, ctx });
				return { content: [{ type: "text", text: "ok" }] };
			},
		});

		expect(harness.tools).toHaveLength(1);
		expect(harness.tools[0]?.name).toBe("test_tool");

		const ctx = harness.makeCtx();
		const result = await harness.invokeTool("test_tool", { input: "x" }, ctx);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.id).toBe("_id_");
		expect(calls[0]?.params).toEqual({ input: "x" });
		expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
	});

	it("seeds flagValues with the registered default", () => {
		harness.pi.registerFlag("bool-flag", { type: "boolean", default: true });
		harness.pi.registerFlag("str-flag", { type: "string", default: "hello" });
		harness.pi.registerFlag("no-default", { type: "boolean" });

		expect(harness.pi.getFlag("bool-flag")).toBe(true);
		expect(harness.pi.getFlag("str-flag")).toBe("hello");
		expect(harness.pi.getFlag("no-default")).toBeUndefined();
		expect(harness.flags.size).toBe(3);
	});

	it("getFlag returns undefined for unknown flags", () => {
		expect(harness.pi.getFlag("not-registered")).toBeUndefined();
	});

	it("records ctx.ui.notify calls in order with severity", () => {
		const ctx = harness.makeCtx();
		ctx.ui.notify("hello", "info");
		ctx.ui.notify("careful", "warning");
		ctx.ui.notify("bad", "error");

		expect(harness.notifications).toEqual([
			{ message: "hello", severity: "info" },
			{ message: "careful", severity: "warning" },
			{ message: "bad", severity: "error" },
		]);
	});

	it("records setStatus keyed by string", () => {
		const ctx = harness.makeCtx();
		ctx.ui.setStatus("rule-count", "5 active");
		ctx.ui.setStatus("errors", "2 errors");
		ctx.ui.setStatus("cleared", undefined);

		expect(harness.statuses.get("rule-count")?.text).toBe("5 active");
		expect(harness.statuses.get("errors")?.text).toBe("2 errors");
		expect(harness.statuses.get("cleared")?.text).toBeUndefined();
		expect(harness.statuses.size).toBe(3);
	});

	it("records setWidget with string-array content", () => {
		const ctx = harness.makeCtx();
		ctx.ui.setWidget("pi-rules", ["line 1", "line 2"]);

		const widget = harness.widgets.get("pi-rules");
		expect(widget).toBeDefined();
		expect(widget?.content).toEqual(["line 1", "line 2"]);
	});

	it("records setWidget clearing (undefined content)", () => {
		const ctx = harness.makeCtx();
		ctx.ui.setWidget("pi-rules", ["line"]);
		ctx.ui.setWidget("pi-rules", undefined);

		const widget = harness.widgets.get("pi-rules");
		expect(widget?.content).toBeUndefined();
	});

	it("executes pi.exec and returns the default response, recording the call", async () => {
		const result = await harness.pi.exec("git", ["status"], { cwd: "/tmp/proj" });
		expect(result).toEqual({ stdout: "", stderr: "", code: 0, killed: false });
		expect(harness.execCalls).toEqual([{ command: "git", args: ["status"], options: { cwd: "/tmp/proj" } }]);
	});

	it("reset() clears all captured state", async () => {
		harness.pi.registerFlag("f", { type: "boolean", default: true });
		harness.pi.registerCommand("c", { description: "x", handler: async () => {} });
		harness.pi.registerTool({
			name: "t",
			label: "t",
			description: "t",
			parameters: {},
			execute: async () => ({ content: [] }),
		});
		harness.pi.on("e", () => {});
		harness.pi.sendUserMessage("hi");
		harness.pi.appendEntry("custom", { foo: 1 });
		await harness.pi.exec("git", ["status"]);
		const ctx = harness.makeCtx();
		ctx.ui.notify("msg", "info");
		ctx.ui.setStatus("s", "t");
		ctx.ui.setWidget("w", ["a"]);

		expect(harness.flags.size).toBeGreaterThan(0);
		expect(harness.commands).toHaveLength(1);
		expect(harness.tools).toHaveLength(1);
		expect(harness.handlers).toHaveLength(1);
		expect(harness.notifications).toHaveLength(1);

		harness.reset();

		expect(harness.flags.size).toBe(0);
		expect(harness.flagValues.size).toBe(0);
		expect(harness.commands).toEqual([]);
		expect(harness.tools).toEqual([]);
		expect(harness.handlers).toEqual([]);
		expect(harness.notifications).toEqual([]);
		expect(harness.statuses.size).toBe(0);
		expect(harness.widgets.size).toBe(0);
		expect(harness.execCalls).toEqual([]);
		expect(harness.entries).toEqual([]);
		expect(harness.userMessages).toEqual([]);
	});

	it("emit chains handler results into the next handler's event", async () => {
		const seen: unknown[] = [];
		harness.pi.on("chain", (event) => {
			seen.push((event as { value: number }).value);
			return { value: ((event as { value: number }).value + 1) as number };
		});
		harness.pi.on("chain", (event) => {
			seen.push((event as { value: number }).value);
		});

		const ctx = harness.makeCtx();
		const result = await harness.emit("chain", { value: 1 }, ctx);

		expect(seen).toEqual([1, 2]);
		expect(result).toEqual({ value: 2 });
	});

	it("makeCtx honours overrides for cwd, signal, and isIdle", () => {
		const ctx = harness.makeCtx({
			cwd: "/custom/cwd",
			signal: new AbortController().signal,
			isIdle: () => false,
		});
		expect(ctx.cwd).toBe("/custom/cwd");
		expect(ctx.signal).toBeInstanceOf(AbortSignal);
		expect(ctx.isIdle()).toBe(false);
	});

	it("makeCommandCtx extends makeCtx with command-only methods", async () => {
		const ctx = harness.makeCommandCtx({ cwd: "/x" });
		expect(ctx.cwd).toBe("/x");
		// waitForIdle, newSession, fork, etc. resolve without throwing
		await expect(ctx.waitForIdle()).resolves.toBeUndefined();
		await expect(ctx.newSession()).resolves.toEqual({ cancelled: false });
		await expect(ctx.fork("entry-1")).resolves.toEqual({ cancelled: false });
		await expect(ctx.navigateTree("target-1")).resolves.toEqual({ cancelled: false });
		await expect(ctx.switchSession("/path/to/session")).resolves.toEqual({ cancelled: false });
		await expect(ctx.reload()).resolves.toBeUndefined();
	});

	it("invokeCommand throws for unknown command names", async () => {
		const ctx = harness.makeCommandCtx();
		await expect(harness.invokeCommand("nope", "", ctx)).rejects.toThrow(/No command registered/);
	});

	it("invokeTool throws for unknown tool names", async () => {
		const ctx = harness.makeCtx();
		await expect(harness.invokeTool("nope", {}, ctx)).rejects.toThrow(/No tool registered/);
	});
});
