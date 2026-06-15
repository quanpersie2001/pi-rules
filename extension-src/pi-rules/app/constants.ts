/**
 * Static constants used across the pi-rules extension.
 *
 * These are pure, dependency-free values that other modules may import without
 * triggering the layered dependency-cruiser rules. Anything that requires
 * runtime configuration (env vars, flags, etc.) should live in `config.ts`
 * instead.
 */

/** Per-rule body cap. Rules longer than this are truncated when formatted. */
export const DEFAULT_MAX_RULE_CHARS = 12_000;

/** Per-injection cap. Total context prompt size cannot exceed this. */
export const DEFAULT_MAX_CONTEXT_CHARS = 40_000;

/** Default number of lines to show from the maintainer log tail. */
export const DEFAULT_MAINTAINER_LOG_LINES = 100;

/** Default maximum number of concurrent maintainer runs per project. */
export const DEFAULT_MAINTAINER_CONCURRENCY = 1;

/** YAML frontmatter delimiter used by parser and the create_rule tool. */
export const FRONTMATTER_DELIMITER = "---";

/** Directory names that the rules scanner should ignore. */
export const SCANNER_EXCLUDED_DIRS: readonly string[] = [
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".turbo",
	"coverage",
];

/** Placeholder inserted when a rule body is truncated. */
export const TRUNCATION_NOTICE_TEMPLATE = "\n\n[... truncated by pi-rules: {path} ...]";

/** Default width for the TUI banner widget when stdout width is unknown. */
export const DEFAULT_BANNER_WIDTH = 80;
