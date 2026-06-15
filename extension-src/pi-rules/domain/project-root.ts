import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Default marker files / directories used to locate the project root. The
 * search walks UP from `startPath` and returns the FIRST directory that
 * contains any of these markers.
 */
export const DEFAULT_PROJECT_MARKERS: readonly string[] = [
	".git",
	"pnpm-workspace.yaml",
	"package.json",
	"pyproject.toml",
	".pi",
];

/**
 * Locate the project root by walking up from `startPath` until a directory
 * containing any of the supplied markers is found. Returns `undefined` when
 * the path does not exist or no marker is found before reaching the
 * filesystem root.
 *
 * Order matters: the first marker in the list wins when several coexist at
 * the same level. Callers that need a different precedence (for example
 * preferring `.pi` over `.git` in pi-rules-only contexts) should reorder
 * the markers array before passing it in.
 *
 * @param startPath  Absolute or relative path to start the search from.
 * @param markers    Optional override for the marker list. Defaults to
 *                   {@link DEFAULT_PROJECT_MARKERS}.
 */
export function findProjectRoot(
	startPath: string,
	markers: ReadonlyArray<string> = DEFAULT_PROJECT_MARKERS,
): string | undefined {
	const resolvedStart = resolve(startPath);

	if (!existsSync(resolvedStart)) {
		return undefined;
	}

	const startStats = statSync(resolvedStart);
	let currentDir = startStats.isDirectory() ? resolvedStart : dirname(resolvedStart);
	const filesystemRoot = resolve("/");

	for (;;) {
		for (const marker of markers) {
			if (existsSync(`${currentDir}/${marker}`)) {
				return currentDir;
			}
		}

		if (currentDir === filesystemRoot) {
			return undefined;
		}

		const parent = dirname(currentDir);
		if (parent === currentDir) {
			return undefined;
		}
		currentDir = parent;
	}
}
