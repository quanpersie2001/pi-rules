/**
 * In-process fake of the Pi `ExtensionAPI` for testing extensions without
 * spinning up the real TUI runner. The harness records every call (events,
 * commands, tools, flags, notifications, widgets, statuses, exec calls,
 * user messages) so tests can drive the extension synchronously and assert
 * on the captured side effects.
 *
 * Usage:
 *   const harness = createFakePi();
 *   piRulesExtension(harness.pi);
 *   const ctx = harness.makeCtx({ cwd: projectDir });
 *   await harness.emit("session_start", event, ctx);
 *   expect(harness.statuses.get("pi-rules")).toBeDefined();
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionHandler,
	ExtensionUIContext,
	ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import { createEventBus, type ExecOptions, type ExecResult } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export interface CapturedCommand {
	name: string;
	options: {
		description?: string;
		handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
	};
}

export interface CapturedTool {
	name: string;
	definition: {
		name: string;
		label?: string;
		description?: string;
		parameters?: unknown;
		execute: (
			toolCallId: string,
			params: unknown,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: ExtensionContext,
		) => Promise<unknown>;
	};
}

export interface CapturedFlag {
	name: string;
	options: { description?: string; type: "boolean" | "string"; default?: boolean | string };
}

export interface CapturedHandler {
	event: string;
	handler: ExtensionHandler<unknown, unknown>;
}

export interface CapturedNotification {
	message: string;
	severity: NotificationSeverity;
}

export interface CapturedWidget {
	key: string;
	content: string[] | undefined | "factory";
	options?: ExtensionWidgetOptions;
}

export interface CapturedStatus {
	key: string;
	text: string | undefined;
}

export interface CapturedExec {
	command: string;
	args: string[];
	options?: ExecOptions;
}

export interface CapturedUserMessage {
	content: string | (TextContent | ImageContent)[];
	options?: { deliverAs?: "steer" | "followUp" };
}

export interface FakePiHarness {
	pi: ExtensionAPI;
	commands: CapturedCommand[];
	tools: CapturedTool[];
	flags: Map<string, CapturedFlag>;
	flagValues: Map<string, boolean | string>;
	handlers: CapturedHandler[];
	notifications: CapturedNotification[];
	widgets: Map<string, CapturedWidget>;
	statuses: Map<string, CapturedStatus>;
	execCalls: CapturedExec[];
	entries: Array<{ customType: string; data: unknown }>;
	userMessages: CapturedUserMessage[];
	/**
	 * Emit an event to all handlers registered for `eventName`. Handlers are
	 * invoked sequentially; if a handler returns a non-undefined result, the
	 * result is merged into the event for the next handler (Pi's hook
	 * chaining behavior).
	 */
	emit(eventName: string, event: unknown, ctx: ExtensionContext): Promise<unknown>;
	/** Build a stub `ExtensionContext` with optional overrides. */
	makeCtx(overrides?: Partial<ExtensionContext>): ExtensionContext;
	/** Build a stub `ExtensionCommandContext` (extends `makeCtx`). */
	makeCommandCtx(overrides?: Partial<ExtensionCommandContext>): ExtensionCommandContext;
	/** Find a captured command by name and invoke it. */
	invokeCommand(name: string, args: string, ctx: ExtensionCommandContext): Promise<void>;
	/** Find a captured tool by name and call its `execute`. */
	invokeTool(name: string, params: unknown, ctx: ExtensionContext): Promise<unknown>;
	/** Reset all captured state (events, notifications, etc.). */
	reset(): void;
}

/**
 * Factory for the fake harness. The returned object is self-contained and
 * safe to instantiate multiple times (one per test).
 */
export function createFakePi(): FakePiHarness {
	const commands: CapturedCommand[] = [];
	const tools: CapturedTool[] = [];
	const flags = new Map<string, CapturedFlag>();
	const flagValues = new Map<string, boolean | string>();
	const handlers: CapturedHandler[] = [];
	const notifications: CapturedNotification[] = [];
	const widgets = new Map<string, CapturedWidget>();
	const statuses = new Map<string, CapturedStatus>();
	const execCalls: CapturedExec[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const userMessages: CapturedUserMessage[] = [];

	const on: ExtensionAPI["on"] = ((event: string, handler: ExtensionHandler<unknown, unknown>) => {
		handlers.push({ event, handler });
	}) as ExtensionAPI["on"];

	const registerTool: ExtensionAPI["registerTool"] = (definition) => {
		const def = definition as unknown as CapturedTool["definition"];
		tools.push({ name: def.name, definition: def });
	};

	const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
		commands.push({
			name,
			options: {
				description: options.description,
				handler: options.handler as CapturedCommand["options"]["handler"],
			},
		});
	};

	const registerFlag: ExtensionAPI["registerFlag"] = (name, options) => {
		flags.set(name, { name, options });
		// Only seed the default if no value was already supplied (e.g. simulating
		// a CLI flag). This lets tests pre-populate flagValues before calling the
		// extension factory and have those values survive the registration call.
		if (options.default !== undefined && !flagValues.has(name)) {
			flagValues.set(name, options.default);
		}
	};

	const getFlag: ExtensionAPI["getFlag"] = (name) => flagValues.get(name);

	const sendUserMessage: ExtensionAPI["sendUserMessage"] = (content, options) => {
		userMessages.push({ content, options });
	};

	const appendEntry: ExtensionAPI["appendEntry"] = (customType, data) => {
		entries.push({ customType, data });
	};

	const exec: ExtensionAPI["exec"] = async (command, args, options) => {
		execCalls.push({ command, args, options });
		const result: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };
		return result;
	};

	// Methods we don't need to observe — typed no-ops that satisfy the
	// `ExtensionAPI` shape.
	const noop = (): void => {};
	const noopAsyncTrue = async (): Promise<boolean> => true;

	const pi = {
		on,
		registerTool: registerTool as ExtensionAPI["registerTool"],
		registerCommand,
		registerFlag,
		registerShortcut: noop as unknown as ExtensionAPI["registerShortcut"],
		getFlag,
		registerMessageRenderer: noop as unknown as ExtensionAPI["registerMessageRenderer"],
		sendMessage: noop as unknown as ExtensionAPI["sendMessage"],
		sendUserMessage,
		appendEntry,
		setSessionName: noop as unknown as ExtensionAPI["setSessionName"],
		getSessionName: () => undefined as string | undefined,
		setLabel: noop as unknown as ExtensionAPI["setLabel"],
		exec,
		getActiveTools: () => tools.map((t) => t.name),
		getAllTools: () => [],
		setActiveTools: noop as unknown as ExtensionAPI["setActiveTools"],
		getCommands: () => [],
		setModel: noopAsyncTrue,
		getThinkingLevel: () => "medium" as const,
		setThinkingLevel: noop as unknown as ExtensionAPI["setThinkingLevel"],
		registerProvider: noop as unknown as ExtensionAPI["registerProvider"],
		unregisterProvider: noop as unknown as ExtensionAPI["unregisterProvider"],
		events: createEventBus(),
	} as unknown as ExtensionAPI;

	function makeUiContext(): ExtensionUIContext {
		const ui = {
			notify: (message: string, severity: NotificationSeverity = "info") => {
				notifications.push({ message, severity });
			},
			setStatus: (key: string, text: string | undefined) => {
				statuses.set(key, { key, text });
			},
			setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) => {
				const recorded: CapturedWidget = {
					key,
					content: Array.isArray(content) ? content : content === undefined ? undefined : "factory",
				};
				if (options !== undefined) recorded.options = options;
				widgets.set(key, recorded);
			},
			setHeader: noop,
			setFooter: noop,
			setEditorComponent: noop,
			setWorkingVisible: noop,
			setWorkingMessage: noop,
			setWorkingIndicator: noop,
			setHiddenThinkingLabel: noop,
			setTitle: noop,
			confirm: async () => true,
			select: async (_title: string, items: string[]) => items[0],
			input: async () => undefined,
			addAutocompleteProvider: () => () => {},
			getAutocompleteCompletions: async () => [] as AutocompleteItem[],
			onTerminalInput: () => () => {},
			pasteToEditor: noop,
			setEditorText: noop,
			getEditorText: () => "",
			editor: async () => undefined,
			custom: <T>(_factory: unknown, _options?: unknown) => Promise.resolve<T>(undefined as T),
			getToolsExpanded: () => false,
			setToolsExpanded: noop,
			theme: {} as never,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: true }),
			getEditorComponent: () => undefined,
		};
		// Cast through unknown to bypass ExtensionUIContext's complex overloads
		// (e.g. setWidget's two-arg variant) and deep Theme type.
		return ui as unknown as ExtensionUIContext;
	}

	function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
		const base = {
			ui: makeUiContext(),
			hasUI: true,
			cwd: process.cwd(),
			sessionManager: { listSessions: () => [], getSession: () => undefined },
			modelRegistry: { listModels: () => [], getModel: () => undefined },
			model: undefined,
			isIdle: () => true,
			signal: undefined,
			abort: noop,
			hasPendingMessages: () => false,
			shutdown: noop,
			getContextUsage: () => undefined,
			compact: noop,
			getSystemPrompt: () => "",
			mode: "tui" as const,
			isProjectTrusted: () => true,
		};
		return { ...base, ...overrides } as unknown as ExtensionContext;
	}

	function makeCommandCtx(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
		const base = {
			...makeCtx(),
			waitForIdle: async () => {},
			newSession: async () => ({ cancelled: false }),
			fork: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
			getSystemPromptOptions: () => ({ contextFiles: [] }),
		};
		return { ...(base as object), ...overrides } as unknown as ExtensionCommandContext;
	}

	async function emit(eventName: string, event: unknown, ctx: ExtensionContext): Promise<unknown> {
		let current: unknown = event;
		let lastResult: unknown;
		for (const entry of handlers) {
			if (entry.event !== eventName) continue;
			const result = await Promise.resolve(entry.handler(current, ctx));
			if (result !== undefined && result !== null) {
				lastResult = result;
				if (current !== null && typeof current === "object") {
					current = { ...(current as Record<string, unknown>), ...(result as Record<string, unknown>) };
				}
			}
		}
		return lastResult;
	}

	async function invokeCommand(name: string, args: string, ctx: ExtensionCommandContext): Promise<void> {
		const captured = commands.find((c) => c.name === name);
		if (captured === undefined) {
			throw new Error(`No command registered with name "${name}"`);
		}
		await captured.options.handler(args, ctx);
	}

	async function invokeTool(name: string, params: unknown, ctx: ExtensionContext): Promise<unknown> {
		const captured = tools.find((t) => t.name === name);
		if (captured === undefined) {
			throw new Error(`No tool registered with name "${name}"`);
		}
		return captured.definition.execute("_id_", params, undefined, undefined, ctx) as unknown;
	}

	function reset(): void {
		commands.length = 0;
		tools.length = 0;
		flags.clear();
		flagValues.clear();
		handlers.length = 0;
		notifications.length = 0;
		widgets.clear();
		statuses.clear();
		execCalls.length = 0;
		entries.length = 0;
		userMessages.length = 0;
	}

	return {
		pi,
		commands,
		tools,
		flags,
		flagValues,
		handlers,
		notifications,
		widgets,
		statuses,
		execCalls,
		entries,
		userMessages,
		emit,
		makeCtx,
		makeCommandCtx,
		invokeCommand,
		invokeTool,
		reset,
	};
}
