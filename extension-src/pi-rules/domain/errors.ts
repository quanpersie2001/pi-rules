/**
 * Domain-level error types raised by the pi-rules parser, scanner, and
 * engine layers. Callers can `instanceof` these to react specifically to
 * rule-loading failures without conflating them with generic I/O or
 * configuration errors.
 */

/**
 * Raised when a rule file's YAML frontmatter cannot be parsed at all
 * (i.e. the file is not a valid frontmatter document). Distinct from
 * `RuleDiagnosticError` because frontmatter parse failures indicate the
 * rule itself is unreadable, not merely misconfigured.
 */
export class RuleParseError extends Error {
	readonly filePath: string;

	constructor(filePath: string, cause: unknown) {
		super(`Failed to parse rule: ${filePath}${cause instanceof Error ? `: ${cause.message}` : ""}`);
		this.name = "RuleParseError";
		this.filePath = filePath;
	}
}

/**
 * Raised for a soft failure observed while processing a single rule:
 * malformed frontmatter values, missing fields, etc. These mirror
 * {@link RuleDiagnostic} entries but as a thrown error so non-default
 * callers (commands, tests, scripts) can opt into strict handling.
 *
 * `severity` mirrors the `RuleDiagnostic.severity` union and `rulePath`
 * is `undefined` when the diagnostic is not associated with a specific
 * file.
 */
export class RuleDiagnosticError extends Error {
	readonly severity: "warning" | "error";
	readonly rulePath: string | undefined;

	constructor(severity: "warning" | "error", rulePath: string | undefined, message: string) {
		super(message);
		this.name = "RuleDiagnosticError";
		this.severity = severity;
		this.rulePath = rulePath;
	}
}

/**
 * Raised when the project-root discovery walk cannot locate a marker
 * before reaching the filesystem root. Hosts that tolerate a fallback
 * (e.g. using the input path directly) should catch this and proceed;
 * strict callers can re-raise.
 */
export class ProjectRootNotFoundError extends Error {
	readonly startPath: string;

	constructor(startPath: string) {
		super(`Project root not found from: ${startPath}`);
		this.name = "ProjectRootNotFoundError";
		this.startPath = startPath;
	}
}
