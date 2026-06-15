import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function normalizePath(input: string): string {
	return input.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function toAbsolutePath(root: string, inputPath: string): string {
	return isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath);
}

export function toRelativeProjectPath(projectRoot: string, inputPath: string): string {
	return normalizePath(relative(projectRoot, toAbsolutePath(projectRoot, inputPath)));
}

export function isSubPath(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function findAncestorContaining(startDir: string, entryName: string): string | undefined {
	let currentDir = resolve(startDir);

	for (;;) {
		if (existsSync(resolve(currentDir, entryName))) {
			return currentDir;
		}
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return undefined;
		}
		currentDir = parentDir;
	}
}

/**
 * Backward-compat wrapper preserved for callers that still import this from
 * `shared/path`. The enhanced, configurable implementation lives in
 * `domain/project-root.ts`; this version hard-codes the original marker
 * list and falls back to `startDir` when no marker is found.
 */
export function findProjectRoot(startDir: string): string {
	return (
		findAncestorContaining(startDir, ".git") ??
		findAncestorContaining(startDir, ".pi") ??
		findAncestorContaining(startDir, "package.json") ??
		resolve(startDir)
	);
}

export function extractPathCandidatesFromText(input: string): string[] {
	const matches = input.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+/g) ?? [];
	return [...new Set(matches.map((match) => normalizePath(match)).filter(Boolean))];
}
