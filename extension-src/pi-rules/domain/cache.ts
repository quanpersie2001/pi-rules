import { fileStatFingerprint } from "../shared/fs.js";
import { now } from "../shared/time.js";
import type { ParsedRule, RuleFile, RuleLoadResult, RuleScanResult } from "./types.js";

/**
 * A function returning a stat fingerprint for a single absolute path, or
 * `"missing"` when the path does not exist. Provided as a dependency so the
 * cache stays pure and can be tested with deterministic inputs.
 */
export type FingerprintFn = (filePath: string) => string;

export type RuleParser = (ruleFile: RuleFile, content: string) => ParsedRule;
export type RuleReader = (path: string) => Promise<string | undefined>;
export type RuleScanner = (cwd: string) => Promise<RuleScanResult>;

export interface RuleCacheDeps {
	/**
	 * Optional fingerprint override (defaults to `fileStatFingerprint` from
	 * `shared/fs.ts`). Use this in tests to avoid relying on real mtimes.
	 */
	fingerprint?: FingerprintFn;
	/**
	 * Optional scanner override. Tests may inject a stub that returns a
	 * pre-built `RuleScanResult`; production code relies on the default
	 * `scanRuleFiles` from `./scanner.js`.
	 */
	scan?: RuleScanner;
	/**
	 * Optional parser for converting a `RuleFile` into a `ParsedRule`. Tests
	 * may inject a stub; production `RulesEngine` supplies `parseRuleFile`.
	 */
	parse?: RuleParser;
	/**
	 * Optional reader for the file contents. Tests may inject a stub;
	 * production `RulesEngine` supplies `readTextFile`.
	 */
	read?: RuleReader;
}

export interface RuleCache {
	/**
	 * Return the cached `RuleLoadResult` if one exists and every on-disk
	 * fingerprint still matches the stored fingerprints. Returns `undefined`
	 * when no cache exists, no scanner is configured, or any file has been
	 * added, removed, or modified.
	 */
	get(cwd: string): Promise<RuleLoadResult | undefined>;
	/**
	 * Force a full reload via the scanner, parse every file, and store the
	 * resulting `RuleLoadResult` (overwriting any previous cache entry).
	 * Returns the freshly loaded result.
	 */
	set(cwd: string): Promise<RuleLoadResult>;
	/**
	 * Drop the stored cache. Subsequent `get` / `set` calls will perform a
	 * fresh scan.
	 */
	invalidate(): void;
	/**
	 * Alias for `invalidate` kept for API symmetry with typical cache stores.
	 */
	clear(): void;
	/**
	 * Whether a cached value currently exists. Does not perform any I/O.
	 */
	has(): boolean;
	/**
	 * Return the currently stored `RuleLoadResult` without touching disk.
	 * Returns `undefined` when the cache is empty.
	 */
	peek(): RuleLoadResult | undefined;
}

/**
 * Build a rule cache instance. The cache stores a single `RuleLoadResult`
 * keyed implicitly by the cwd it was loaded from. `get` performs a fast
 * fingerprint check; `set` always performs a full scan and rebuild.
 *
 * When no `parse` / `read` dependencies are provided, `set` still rebuilds
 * the cache and stores the per-file fingerprints, but `result.rules` will
 * be empty. Hosts that need parsed rule bodies (the typical case) supply
 * `read` and `parse` so `set` produces a fully populated `RuleLoadResult`.
 */
export function createRuleCache(deps: RuleCacheDeps = {}): RuleCache {
	const fingerprint = deps.fingerprint ?? fileStatFingerprint;
	const scan = deps.scan;
	const read = deps.read;
	const parse = deps.parse;
	let cached: RuleLoadResult | undefined;

	async function loadFromDisk(cwd: string): Promise<RuleLoadResult> {
		if (scan === undefined) {
			throw new Error("RuleCache.set requires a `scan` dependency");
		}
		const scanResult = await scan(cwd);
		const fingerprints = new Map<string, string>();
		const rules: ParsedRule[] = [];

		for (const ruleFile of scanResult.ruleFiles) {
			fingerprints.set(ruleFile.relativePath, ruleFile.fingerprint ?? fingerprint(ruleFile.absolutePath));
			if (read !== undefined && parse !== undefined) {
				const content = await read(ruleFile.absolutePath);
				if (content === undefined) {
					continue;
				}
				rules.push(parse(ruleFile, content));
			}
		}

		return {
			projectRoot: scanResult.projectRoot,
			rules,
			diagnostics: scanResult.diagnostics,
			scannedAt: now(),
			fingerprints,
		};
	}

	async function isCacheValid(cwd: string): Promise<boolean> {
		if (cached === undefined || scan === undefined) {
			return false;
		}

		const scanResult = await scan(cwd);
		if (scanResult.ruleFiles.length !== cached.fingerprints.size) {
			return false;
		}

		for (const ruleFile of scanResult.ruleFiles) {
			const stored = cached.fingerprints.get(ruleFile.relativePath);
			if (stored === undefined) {
				return false;
			}
			const current = ruleFile.fingerprint ?? fingerprint(ruleFile.absolutePath);
			if (current !== stored) {
				return false;
			}
		}

		return true;
	}

	return {
		async get(cwd: string): Promise<RuleLoadResult | undefined> {
			if (cached === undefined) {
				return undefined;
			}
			if (await isCacheValid(cwd)) {
				return cached;
			}
			return undefined;
		},
		async set(cwd: string): Promise<RuleLoadResult> {
			cached = await loadFromDisk(cwd);
			return cached;
		},
		invalidate(): void {
			cached = undefined;
		},
		clear(): void {
			cached = undefined;
		},
		has(): boolean {
			return cached !== undefined;
		},
		peek(): RuleLoadResult | undefined {
			return cached;
		},
	};
}
