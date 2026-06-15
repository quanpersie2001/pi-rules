/**
 * Zero-dependency glob pattern matcher.
 *
 * Supports the subset of glob syntax used in .pi/rules paths:
 * - * matches any characters except /
 * - ** matches any characters including / (recursive)
 * - ? matches exactly one character except /
 * - {a,b} matches either a or b (alternatives)
 * - Dot files are matched by default (consistent with picomatch dot:true)
 */

/**
 * Test whether a file path matches a glob pattern.
 *
 * Both path and pattern are normalized (backslashes become forward slashes,
 * leading ./ and / stripped).
 *
 * @param filePath - Project-relative file path (e.g. src/index.ts)
 * @param pattern - Glob pattern (e.g. src/**\/*.ts)
 * @returns true if the path matches the pattern
 */
export function globMatch(filePath: string, pattern: string): boolean {
	const normalizedPath = normalizeGlobPath(filePath);
	const normalizedPattern = normalizeGlobPath(pattern);

	try {
		const regex = globToRegex(normalizedPattern);
		return regex.test(normalizedPath);
	} catch {
		// Invalid pattern means no match
		return false;
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a path for glob matching:
 * - Backslashes become forward slashes
 * - Strip leading ./
 * - Strip leading /
 * - Strip trailing /
 */
function normalizeGlobPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
}

/**
 * Convert a glob pattern string into a RegExp.
 *
 * Supports *, **, ?, and {a,b} alternatives.
 */
function globToRegex(pattern: string): RegExp {
	let regex = "";
	let i = 0;

	while (i < pattern.length) {
		const ch = pattern[i];
		const next = pattern[i + 1];
		const afterNext = pattern[i + 2];

		// **/ means match any directory prefix (including none)
		if (ch === "*" && next === "*" && afterNext === "/") {
			regex += "(?:.*?/)?";
			i += 3;
			continue;
		}

		// ** at end or followed by non-/ means match anything
		if (ch === "*" && next === "*") {
			regex += ".*";
			i += 2;
			continue;
		}

		// * means match anything except /
		if (ch === "*") {
			regex += "[^/]*";
			i += 1;
			continue;
		}

		// ? means match one char except /
		if (ch === "?") {
			regex += "[^/]";
			i += 1;
			continue;
		}

		// {a,b} means alternatives
		if (ch === "{") {
			const closeIndex = pattern.indexOf("}", i + 1);
			if (closeIndex !== -1) {
				const alternatives = pattern.slice(i + 1, closeIndex).split(",");
				regex += "(?:" + alternatives.map(escapeRegex).join("|") + ")";
				i = closeIndex + 1;
				continue;
			}
		}

		// Literal character (escape regex special chars)
		regex += escapeRegexChar(ch);
		i += 1;
	}

	return new RegExp(`^${regex}$`);
}

/**
 * Escape all regex-special characters in a string.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape a single character for use in a regex.
 */
function escapeRegexChar(ch: string): string {
	if (/[.+^${}()|[\]\\/]/.test(ch)) {
		return `\\${ch}`;
	}
	return ch;
}
