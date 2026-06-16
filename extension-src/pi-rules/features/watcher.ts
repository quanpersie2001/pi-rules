import { type FSWatcher, watch as fsWatch } from "node:fs";

export interface WatcherOptions {
	/** Directories to watch recursively. */
	roots: string[];
	/** Called (debounced) when any watched file changes. */
	onChange: () => void;
	/** Debounce window in milliseconds (default 100). */
	debounceMs?: number;
}

export interface Watcher {
	stop(): Promise<void>;
}

/**
 * Start watching rule directories for file changes. When a change is
 * detected, `onChange` is called after a debounce window so that rapid
 * edits (e.g. save + format) only trigger a single recompile.
 *
 * Errors from the underlying `fs.watch` are logged to stderr; the watcher
 * continues watching the remaining roots.
 */
export function startWatcher(opts: WatcherOptions): Watcher {
	const debounceMs = opts.debounceMs ?? 100;
	const watchers: FSWatcher[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const fire = (): void => {
		timer = null;
		if (stopped) return;
		try {
			opts.onChange();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[pi-rules] watcher onChange threw: ${msg}\n`);
		}
	};

	const schedule = (): void => {
		if (stopped) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(fire, debounceMs);
	};

	for (const root of opts.roots) {
		try {
			const w = fsWatch(root, { recursive: true }, () => schedule());
			w.on("error", (err: Error) => {
				process.stderr.write(`[pi-rules] watcher error (${root}): ${err.message}\n`);
			});
			watchers.push(w);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[pi-rules] failed to watch ${root}: ${msg}\n`);
		}
	}

	return {
		stop: async (): Promise<void> => {
			stopped = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			for (const w of watchers) {
				try {
					w.close();
				} catch {
					// best-effort close
				}
			}
		},
	};
}
