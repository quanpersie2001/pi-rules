import { existsSync, statSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function ensureDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

export async function readTextFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}

export async function writeTextFile(path: string, content: string): Promise<void> {
	await ensureDirectory(dirname(path));
	await writeFile(path, content, "utf8");
}

export async function appendTextFile(path: string, content: string): Promise<void> {
	await ensureDirectory(dirname(path));
	await appendFile(path, content, "utf8");
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
	const content = await readTextFile(path);
	if (content === undefined) {
		return fallback;
	}
	try {
		return JSON.parse(content) as T;
	} catch {
		return fallback;
	}
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
	const results: string[] = [];
	if (!existsSync(rootDir)) {
		return results;
	}
	const entries = await readdir(rootDir, { withFileTypes: true });
	for (const entry of entries) {
		const absolutePath = resolve(rootDir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await listFilesRecursive(absolutePath)));
			continue;
		}
		results.push(absolutePath);
	}
	return results.sort((left, right) => left.localeCompare(right));
}

export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function removeFile(path: string): Promise<void> {
	await rm(path, { force: true });
}

export async function resolveRealPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}

/**
 * Compute a stat-based fingerprint for a file without reading its contents.
 * Uses mtimeNs, ctimeNs, and size. Returns "missing" when the file does not exist.
 */
export function fileStatFingerprint(filePath: string): string {
	try {
		const stats = statSync(filePath, { bigint: true });
		return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
	} catch {
		return "missing";
	}
}
