/**
 * Zero-dependency YAML frontmatter parser.
 *
 * Supports the subset of YAML used in .pi/rules files:
 * - Scalar strings (quoted and unquoted)
 * - Booleans (true/false)
 * - Numbers (integers and floats)
 * - Block lists (- item)
 * - Comma-separated inline lists ([a, b, c] or a, b, c)
 */

/** Parsed frontmatter data as a plain record. */
export type FrontmatterData = Record<string, unknown>;

/** Result of parsing frontmatter from content. */
export interface FrontmatterResult {
	/** Parsed frontmatter key-value pairs. Empty object if no frontmatter found. */
	data: FrontmatterData;
	/** Body content after the frontmatter delimiter. */
	content: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Expects content to start with --- delimiter. If no frontmatter is found,
 * returns empty data and the original content as-is.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
	if (!content.startsWith("---")) {
		return { data: {}, content };
	}

	const endIndex = content.indexOf("---", 3);
	if (endIndex === -1) {
		return { data: {}, content };
	}

	const rawBlock = content.slice(3, endIndex);
	const body = content.slice(endIndex + 3).trim();
	const data = parseYamlBlock(rawBlock);

	return { data, content: body };
}

// ---------------------------------------------------------------------------
// Internal YAML parser (minimal subset)
// ---------------------------------------------------------------------------

function parseYamlBlock(block: string): FrontmatterData {
	const result: FrontmatterData = {};
	let currentListKey: string | undefined;

	for (const rawLine of block.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+$/, "");

		// List item: "  - value"
		const listItemMatch = line.match(/^\s+-\s+(.+?)\s*$/);
		if (listItemMatch && currentListKey) {
			const existing = result[currentListKey];
			if (Array.isArray(existing)) {
				existing.push(parseScalar(stripQuotes(listItemMatch[1])));
			}
			continue;
		}

		// Key-value: "key: value" or "key:" (empty value = start of list)
		const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
		if (kvMatch) {
			const [, key, rawValue] = kvMatch;

			if (rawValue === "") {
				// Empty value means start a list
				result[key] = [];
				currentListKey = key;
			} else {
				// Inline scalar or inline list
				result[key] = parseValue(rawValue);
				currentListKey = undefined;
			}
			continue;
		}

		// Non-indented non-empty line means reset list context
		if (/^\S/.test(line) && line.length > 0) {
			currentListKey = undefined;
		}
	}

	return result;
}

/**
 * Parse a YAML value string into a JS value.
 *
 * Handles: booleans, numbers, inline arrays [a, b], comma-separated lists,
 * and quoted/unquoted strings.
 *
 * Throws on clearly invalid syntax (e.g. unclosed brackets).
 */
function parseValue(rawValue: string): unknown {
	const trimmed = rawValue.trim();

	// Inline array: [a, b, c]
	if (trimmed.startsWith("[")) {
		if (!trimmed.endsWith("]")) {
			throw new Error(`Invalid YAML: unclosed bracket in "${trimmed}"`);
		}
		const inner = trimmed.slice(1, -1);
		if (inner.trim() === "") return [];
		return inner.split(",").map((item) => parseScalar(stripQuotes(item.trim())));
	}

	// Comma-separated list (only if contains unquoted commas and no quotes)
	if (trimmed.includes(",") && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
		const items = trimmed.split(",").map((item) => parseScalar(stripQuotes(item.trim())));
		if (items.length > 1) return items;
	}

	return parseScalar(trimmed);
}

/**
 * Parse a scalar value: boolean, number, or string.
 *
 * Strips surrounding quotes from string values.
 */
function parseScalar(value: string): unknown {
	// Strip quotes first
	const unquoted = stripQuotes(value);

	if (unquoted === "true") return true;
	if (unquoted === "false") return false;
	if (unquoted === "null" || unquoted === "~" || unquoted === "") return null;

	// Integer
	const intMatch = unquoted.match(/^-?\d+$/);
	if (intMatch) {
		const num = Number.parseInt(unquoted, 10);
		if (Number.isSafeInteger(num)) return num;
	}

	// Float
	const floatMatch = unquoted.match(/^-?\d+\.\d+$/);
	if (floatMatch) {
		const num = Number.parseFloat(unquoted);
		if (Number.isFinite(num)) return num;
	}

	return unquoted;
}

/**
 * Strip surrounding single or double quotes from a value.
 */
function stripQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/g, "");
}
