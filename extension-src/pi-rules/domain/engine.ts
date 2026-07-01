import { fileStatFingerprint, readTextFile } from "../shared/fs.js";
import { createId } from "../shared/id.js";
import { now } from "../shared/time.js";
import { formatRuleContext } from "./formatter.js";
import { matchByTriggers, matchRules } from "./matcher.js";
import { parseRuleFile } from "./parser.js";
import { scanRuleFiles } from "./scanner.js";
import type {
	InjectionRecord,
	MatchedRule,
	ParsedRule,
	RuleContextResult,
	RuleFile,
	RuleLoadResult,
	RuleStatus,
} from "./types.js";

export interface RulesEngineOptions {
	maxRuleChars: number;
	maxContextChars: number;
}

/**
 * Tracks per-turn injection state to prevent duplicate injections
 * within the same turn (when the same rule matches multiple target paths).
 */
interface TurnInjectionState {
	/** Set of `<realPath>::<contentHash>` keys injected this turn. */
	staticInjected: Set<string>;
	/** Map of `targetPath → Set<realPath::contentHash>` for dynamic injection. */
	dynamicInjected: Map<string, Set<string>>;
}

function staticDedupKey(rule: ParsedRule): string {
	return `${rule.realPath}::${rule.contentHash}`;
}

/**
 * Deduplicate matches by ruleId, keeping the first occurrence.
 * Prevents a rule from appearing twice when matched by both path and trigger.
 */
function dedupeMatches(matches: MatchedRule[]): MatchedRule[] {
	const seen = new Set<string>();
	const result: MatchedRule[] = [];
	for (const match of matches) {
		if (!seen.has(match.ruleId)) {
			seen.add(match.ruleId);
			result.push(match);
		}
	}
	return result;
}

function dynamicDedupKey(scopeKey: string, rule: ParsedRule): string {
	return `${scopeKey}::${rule.realPath}::${rule.contentHash}`;
}

export class RulesEngine {
	private cache?: RuleLoadResult;
	private lastContext?: InjectionRecord;
	private turnState: TurnInjectionState = { staticInjected: new Set(), dynamicInjected: new Map() };

	constructor(private readonly options: RulesEngineOptions) {}

	get formatOptions(): RulesEngineOptions {
		return { ...this.options };
	}

	async loadRules(cwd: string, forceReload = false): Promise<RuleLoadResult> {
		if (this.cache !== undefined && !forceReload) {
			return this.cache;
		}

		// Full reload path
		const scanResult = await scanRuleFiles(cwd);
		const rules: ParsedRule[] = [];
		const diagnostics = [...scanResult.diagnostics];
		const fingerprints = new Map<string, string>();

		for (const ruleFile of scanResult.ruleFiles) {
			fingerprints.set(ruleFile.relativePath, ruleFile.fingerprint);
			const content = await readTextFile(ruleFile.absolutePath);
			if (content === undefined) {
				diagnostics.push({
					severity: "warning",
					rulePath: ruleFile.relativePath,
					message: "Unable to read rule file",
				});
				continue;
			}
			const parsedRule = parseRuleFile(ruleFile, content);
			rules.push(parsedRule);
			diagnostics.push(...parsedRule.diagnostics);
		}

		this.cache = {
			projectRoot: scanResult.projectRoot,
			rules,
			diagnostics,
			scannedAt: now(),
			fingerprints,
		};
		return this.cache;
	}

	/**
	 * Quick-check whether cached rules are still up-to-date by comparing
	 * on-disk stat fingerprints against stored fingerprints. Returns true
	 * when no rule file has been modified, added, or removed.
	 */
	async fingerprintsMatch(cwd: string): Promise<boolean> {
		if (this.cache === undefined) {
			return false;
		}

		// Re-scan to discover any added/removed files
		const scanResult = await scanRuleFiles(cwd);

		// Quick check: same number of files?
		if (scanResult.ruleFiles.length !== this.cache.fingerprints.size) {
			return false;
		}

		// Check each file's current stat fingerprint against the stored value
		for (const ruleFile of scanResult.ruleFiles) {
			const storedFingerprint = this.cache.fingerprints.get(ruleFile.relativePath);
			if (storedFingerprint === undefined) {
				return false; // New file appeared
			}
			const currentFingerprint = fileStatFingerprint(ruleFile.absolutePath);
			if (currentFingerprint !== storedFingerprint) {
				return false; // File modified
			}
		}

		return true;
	}

	/**
	 * Like loadRules but uses fingerprint matching to avoid re-reading files
	 * when possible. Falls back to full load when fingerprints have changed.
	 */
	async loadRulesIfUnchanged(cwd: string): Promise<RuleLoadResult> {
		if (await this.fingerprintsMatch(cwd)) {
			return this.cache!;
		}
		return this.loadRules(cwd, true);
	}

	async matchRulesForPaths(cwd: string, targetPaths: string[], promptText?: string): Promise<RuleContextResult> {
		const loaded = await this.loadRulesIfUnchanged(cwd);
		const pathMatches = matchRules(loaded.rules, targetPaths);
		const triggerMatches = promptText ? matchByTriggers(loaded.rules, promptText) : [];
		const matches = dedupeMatches([...pathMatches, ...triggerMatches]);
		const formatted = formatRuleContext(matches, this.options);
		return {
			targetPaths,
			matches,
			prompt: formatted.prompt,
			truncated: formatted.truncated,
		};
	}

	/**
	 * Like matchRulesForPaths but filters out rules already injected
	 * in the current turn (context file dedup for static injection).
	 */
	async matchRulesForPathsStatic(
		cwd: string,
		targetPaths: string[],
		contextFileRealPaths: Set<string>,
		promptText?: string,
	): Promise<RuleContextResult> {
		const loaded = await this.loadRulesIfUnchanged(cwd);
		// Filter out rules whose file is already loaded as a native context file (AGENTS.md / CLAUDE.md overlap)
		const filteredRules = loaded.rules.filter(
			(rule) => !contextFileRealPaths.has(rule.realPath) && !contextFileRealPaths.has(rule.absolutePath),
		);
		// Also filter out already-injected-in-this-turn rules
		const dedupedRules = filteredRules.filter((rule) => !this.turnState.staticInjected.has(staticDedupKey(rule)));
		const pathMatches = matchRules(dedupedRules, targetPaths);
		const triggerMatches = promptText ? matchByTriggers(dedupedRules, promptText) : [];
		const matches = dedupeMatches([...pathMatches, ...triggerMatches]);
		const formatted = formatRuleContext(matches, this.options);
		return {
			targetPaths,
			matches,
			prompt: formatted.prompt,
			truncated: formatted.truncated,
		};
	}

	/**
	 * Like matchRulesForPaths but filters out rules already dynamically injected
	 * for a specific scope key (target path) in the current turn.
	 */
	async matchRulesForPathsDynamic(cwd: string, targetPaths: string[], promptText?: string): Promise<RuleContextResult> {
		const loaded = await this.loadRulesIfUnchanged(cwd);
		const scopeKey = targetPaths[0] ?? "_all";
		const injectedInScope = this.turnState.dynamicInjected.get(scopeKey) ?? new Set();
		const dedupedRules = loaded.rules.filter((rule) => !injectedInScope.has(staticDedupKey(rule)));
		const pathMatches = matchRules(dedupedRules, targetPaths);
		const triggerMatches = promptText ? matchByTriggers(dedupedRules, promptText) : [];
		const matches = dedupeMatches([...pathMatches, ...triggerMatches]);
		const formatted = formatRuleContext(matches, this.options);
		return {
			targetPaths,
			matches,
			prompt: formatted.prompt,
			truncated: formatted.truncated,
		};
	}

	markStaticInjected(rule: ParsedRule): void {
		this.turnState.staticInjected.add(staticDedupKey(rule));
	}

	markDynamicInjected(scopeKey: string, rule: ParsedRule): void {
		const set = this.turnState.dynamicInjected.get(scopeKey) ?? new Set();
		set.add(staticDedupKey(rule));
		this.turnState.dynamicInjected.set(scopeKey, set);
	}

	markStaticInjectedBatch(rules: readonly MatchedRule[]): void {
		for (const rule of rules) {
			this.turnState.staticInjected.add(staticDedupKey(rule));
		}
	}

	markDynamicInjectedBatch(scopeKey: string, rules: readonly MatchedRule[]): void {
		const set = this.turnState.dynamicInjected.get(scopeKey) ?? new Set();
		for (const rule of rules) {
			set.add(staticDedupKey(rule));
		}
		this.turnState.dynamicInjected.set(scopeKey, set);
	}

	wasFullInjected(rule: ParsedRule): boolean {
		const key = staticDedupKey(rule);
		if (this.turnState.staticInjected.has(key)) return true;
		for (const injected of this.turnState.dynamicInjected.values()) {
			if (injected.has(key)) return true;
		}
		return false;
	}

	recordInjection(targetPaths: string[], context: RuleContextResult): InjectionRecord {
		const record: InjectionRecord = {
			turnId: createId("turn"),
			targetPaths,
			rules: context.matches.map((match) => ({
				ruleId: match.ruleId,
				relativePath: match.relativePath,
				summary: match.frontmatter.summary,
				matchReason: match.matchReason,
			})),
			injectedAt: now(),
			truncated: context.truncated,
		};
		this.lastContext = record;
		return record;
	}

	getLastContext(): InjectionRecord | undefined {
		return this.lastContext;
	}

	async getStatus(cwd: string): Promise<RuleStatus> {
		const loaded = await this.loadRulesIfUnchanged(cwd);
		return {
			projectRoot: loaded.projectRoot,
			rulesDir: `${loaded.projectRoot}/.pi/rules`,
			ruleCount: loaded.rules.length,
			diagnostics: loaded.diagnostics,
			rules: loaded.rules,
			lastContext: this.lastContext,
		};
	}

	clearCache(): void {
		this.cache = undefined;
	}

	resetTurn(): void {
		this.turnState = { staticInjected: new Set(), dynamicInjected: new Map() };
	}
}
