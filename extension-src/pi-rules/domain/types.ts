export interface RuleFrontmatter {
	paths?: string | string[];
	summary?: string;
	alwaysApply?: boolean;
	description?: string;
	priority?: number;
	kind?: "rules" | "inventory";
	triggers?: string[];
	/** When true, writes/edits to matching files are blocked until this rule has been injected in full. */
	guard?: boolean;
}

export interface RuleDiagnostic {
	severity: "warning" | "error";
	rulePath?: string;
	message: string;
}

export interface RuleFile {
	absolutePath: string;
	realPath: string;
	relativePath: string;
	ruleId: string;
	contentHash: string;
	fingerprint: string;
}

export interface ParsedRule extends RuleFile {
	frontmatter: RuleFrontmatter;
	body: string;
	diagnostics: RuleDiagnostic[];
}

export type MatchReason =
	| { type: "alwaysApply" }
	| { type: "path"; targetPath: string; pattern: string }
	| { type: "trigger"; trigger: string };

export interface MatchedRule extends ParsedRule {
	matchReason: MatchReason;
}

export interface InjectionRecord {
	turnId: string;
	targetPaths: string[];
	rules: Array<{
		ruleId: string;
		relativePath: string;
		summary?: string;
		matchReason: MatchReason;
	}>;
	injectedAt: number;
	truncated: boolean;
}

export interface RuleScanResult {
	projectRoot: string;
	rulesDir: string;
	ruleFiles: RuleFile[];
	diagnostics: RuleDiagnostic[];
}

export interface RuleLoadResult {
	projectRoot: string;
	rules: ParsedRule[];
	diagnostics: RuleDiagnostic[];
	scannedAt: number;
	/**
	 * Map of relative rule path → stat fingerprint at time of loading.
	 * Used to detect which files changed without re-reading content.
	 */
	fingerprints: Map<string, string>;
}

export interface RuleContextResult {
	targetPaths: string[];
	matches: MatchedRule[];
	prompt: string;
	truncated: boolean;
}

export interface RuleStatus {
	projectRoot: string;
	rulesDir: string;
	ruleCount: number;
	diagnostics: RuleDiagnostic[];
	rules: ParsedRule[];
	lastContext?: InjectionRecord;
}
