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
				paths.add(candidate);
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
				results.push(toRelativeProjectPath(projectRoot, path));
			}
		}
	}
	return results.filter((p) => p.length > 0 && !p.startsWith(".."));
}

export function extractPromptPaths(prompt: string): string[] {
	const matches = prompt.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+/g) ?? [];
	return [...new Set(matches.map((match) => normalizePath(match)))];
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
		if (normalized.length > 0 && !normalized.startsWith("/") && !normalized.startsWith("~")) {
			results.add(normalized);
		}
	}

	// Detect rm/rmdir patterns
	const rmMatches = command.match(/\brm\s+(?:-[rfiv]+\s+)*([^\s&|;]+)/g);
	if (rmMatches) {
		for (const match of rmMatches) {
			const path = match.replace(/^rm\s+(?:-[rfiv]+\s+)*/, "").trim();
			if (path && !path.startsWith("-")) {
				results.add(normalizePath(path));
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
			if (parts.length >= 2) {
				results.add(normalizePath(parts[0]!));
				results.add(normalizePath(parts[1]!));
			}
		}
	}

	return [...results];
}
