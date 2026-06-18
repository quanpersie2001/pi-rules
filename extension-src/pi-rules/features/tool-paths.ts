import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { normalizePath, toRelativeProjectPath } from "../shared/path.js";

export function extractToolPaths(event: ToolResultEvent, projectRoot: string): string[] {
	const paths = new Set<string>();

	if (hasPathInput(event.input)) {
		paths.add(toRelativeProjectPath(projectRoot, event.input.path));
	}

	if (event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls") {
		const pathValue = event.input.path;
		if (typeof pathValue === "string" && pathValue.length > 0) {
			paths.add(toRelativeProjectPath(projectRoot, pathValue));
		}
	}

	if (event.toolName === "bash") {
		const command = event.input.command;
		if (typeof command === "string") {
			for (const candidate of extractPathsFromBashCommand(command)) {
				if (isValidPathToken(candidate)) {
					paths.add(candidate);
				}
			}
		}
	}

	return [...paths].filter((path) => path.length > 0 && !path.startsWith(".."));
}

/**
 * Extract paths that are being removed by a bash command (rm/rmdir patterns).
 * Returns project-relative paths.
 */
export function extractRemovedPaths(command: string, projectRoot: string): string[] {
	const results: string[] = [];
	const rmMatches = command.match(/\brm\s+(?:-[rfiv]+\s+)*([^\s&|;]+)/g);
	if (rmMatches) {
		for (const match of rmMatches) {
			const path = match.replace(/^rm\s+(?:-[rfiv]+\s+)*/, "").trim();
			if (path && !path.startsWith("-")) {
				const normalized = normalizePath(path);
				if (isValidPathToken(normalized)) {
					results.push(toRelativeProjectPath(projectRoot, normalized));
				}
			}
		}
	}
	return results.filter((p) => p.length > 0 && !p.startsWith(".."));
}

export function extractPromptPaths(prompt: string): string[] {
	const matches = prompt.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+/g) ?? [];
	return [...new Set(matches.map((match) => normalizePath(match)).filter(isValidPathToken))];
}

function hasPathInput(input: Record<string, unknown>): input is Record<string, unknown> & { path: string } {
	return typeof input.path === "string";
}

function extractPathsFromBashCommand(command: string): string[] {
	const tokens = command.match(/(?:\.|[^\s"'])+/g) ?? [];
	const results = new Set<string>();
	for (const token of tokens) {
		if (token.startsWith("-") || token.includes("=")) continue;
		if (!token.includes("/") && !token.includes(".")) continue;
		const normalized = normalizePath(token.replace(/^['"]|['"]$/g, ""));
		if (
			normalized.length > 0 &&
			!normalized.startsWith("/") &&
			!normalized.startsWith("~") &&
			isValidPathToken(normalized)
		) {
			results.add(normalized);
		}
	}

	// Detect rm/rmdir patterns
	const rmMatches = command.match(/\brm\s+(?:-[rfiv]+\s+)*([^\s&|;]+)/g);
	if (rmMatches) {
		for (const match of rmMatches) {
			const path = match.replace(/^rm\s+(?:-[rfiv]+\s+)*/, "").trim();
			if (path && !path.startsWith("-")) {
				const normalized = normalizePath(path);
				if (isValidPathToken(normalized)) {
					results.add(normalized);
				}
			}
		}
	}

	// Detect mv patterns (old + new path)
	const mvMatches = command.match(/\bmv\s+(?:-[fivnT]+\s+)*([^\s&|;]+)\s+([^\s&|;]+)/g);
	if (mvMatches) {
		for (const match of mvMatches) {
			const parts = match
				.replace(/^mv\s+(?:-[fivnT]+\s+)*/, "")
				.trim()
				.split(/\s+/);
			for (const part of parts) {
				const normalized = normalizePath(part);
				if (isValidPathToken(normalized)) results.add(normalized);
			}
		}
	}

	return [...results];
}

/**
 * Validate that a token looks like a real (relative) file path rather than
 * shell syntax, a glob pattern, a code fragment, or other noise.
 */
function isValidPathToken(token: string): boolean {
	if (token.length === 0) return false;

	// -- Shell redirects --
	if (token === "/dev/null") return false;
	if (/^\d*[&|]?>/.test(token)) return false; // 2>/dev/null, &>/tmp, 1>file
	if (/^[&|]/.test(token)) return false; // &>>, |&

	// -- Glob / wildcard patterns --
	if (token.includes("*") || token.includes("?") || token.includes("!")) return false;

	// -- Brackets/code fragments --
	if (/[{}()[\]]/.test(token)) return false;

	// -- Shell variables and shebang --
	if (token.startsWith("$") || token.startsWith("#!")) return false;

	// -- Leading shell metacharacters --
	if (/^[&|;,:`]/.test(token)) return false;

	// -- Numbered list items ("1.", "2.") --
	if (/^\d+\.$/.test(token)) return false;

	// -- Pure version numbers ("1.2.3") --
	if (/^\d+(\.\d+)+$/.test(token)) return false;

	// -- Bare extensions like ".cs", ".csproj" without a path --
	if (/^\.[a-zA-Z][a-zA-Z0-9]*$/.test(token) && !token.includes("/")) return false;

	// -- Pure operators ".", "..", "/", "//" --
	if (/^[./]+$/.test(token)) return false;

	// -- Three or more trailing dots ("file.cs...") --
	if (/\.{3,}$/.test(token)) return false;

	// -- Must contain at least one alphanumeric character --
	if (!/[a-zA-Z0-9]/.test(token)) return false;

	// -- Must be at least 2 chars for dot-containing tokens without slash --
	//    This filters single-char noise like "." while allowing "src/file"
	if (!token.includes("/") && token.length < 2) return false;

	return true;
}
