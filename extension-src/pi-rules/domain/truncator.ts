/**
 * Truncation helpers for rule bodies and rule-context blocks.
 *
 * Two responsibilities:
 *
 *  - {@link truncateRuleBody} keeps a single rule body within a per-rule char
 *    budget. The slice is surrogate-pair safe so multibyte emoji and
 *    non-BMP code points are never split in half.
 *  - {@link truncateBudget} fits many rule bodies into a single context
 *    block. Earlier rules claim their full body, later rules are clipped or
 *    dropped when the running budget is exhausted.
 *
 * Both helpers accept a configurable notice template. The placeholder
 * `{path}` is replaced with the rule's relative path so the model can find
 * the full file on disk.
 */

/**
 * Default notice template. `{path}` is replaced with the rule's relative
 * path; callers can override the wording by passing a custom `noticeTemplate`.
 */
export const DEFAULT_TRUNCATION_NOTICE = "\n\n[... truncated by pi-rules: {path} ...]";

/**
 * Truncation result. `body` is the (possibly clipped) text. `truncated` is
 * `true` when the input did not fit and was clipped. `originalLength` is
 * always the input length in UTF-16 code units, regardless of truncation.
 */
export interface TruncationResult {
	body: string;
	truncated: boolean;
	originalLength: number;
}

export interface TruncateRuleOptions {
	/** Maximum number of UTF-16 code units the result is allowed to occupy. */
	maxChars: number;
	/** Rule path inserted into the notice template. */
	relativePath: string;
	/**
	 * Optional notice template override. The literal substring `{path}` is
	 * replaced with `relativePath`. Defaults to
	 * {@link DEFAULT_TRUNCATION_NOTICE}.
	 */
	noticeTemplate?: string;
}

export interface TruncateBudgetRule {
	body: string;
	relativePath: string;
}

export interface TruncatedBudgetRule {
	body: string;
	truncated: boolean;
	relativePath: string;
}

export interface TruncateBudgetOptions {
	rules: ReadonlyArray<TruncateBudgetRule>;
	/** Total character budget shared across all rules in `rules`. */
	maxResultChars: number;
	/** Optional notice template override (see {@link TruncateRuleOptions}). */
	noticeTemplate?: string;
}

function renderNotice(template: string, relativePath: string): string {
	return template.replaceAll("{path}", relativePath);
}

/**
 * Return a slice end index that does not split a UTF-16 surrogate pair.
 *
 * JS strings are sequences of UTF-16 code units. Emoji and other non-BMP
 * code points are encoded as a high surrogate (`0xD800..0xDBFF`) followed by
 * a low surrogate (`0xDC00..0xDFFF`). Slicing between them produces an
 * invalid string that can corrupt downstream output; this helper backs off
 * one code unit when the boundary lands on a high surrogate.
 */
function safeSliceEnd(body: string, end: number): number {
	if (end <= 0) {
		return 0;
	}
	const lastCodeUnit = body.charCodeAt(end - 1);
	if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
		return end - 1;
	}
	return end;
}

/**
 * Clip a single rule body to at most `maxChars` code units. When clipping is
 * required, the result is the clipped prefix + a notice indicating where
 * the full rule can be read.
 */
export function truncateRuleBody(body: string, options: TruncateRuleOptions): TruncationResult {
	const noticeTemplate = options.noticeTemplate ?? DEFAULT_TRUNCATION_NOTICE;
	const notice = renderNotice(noticeTemplate, options.relativePath);

	if (body.length <= options.maxChars) {
		return { body, truncated: false, originalLength: body.length };
	}

	if (options.maxChars <= 0) {
		return { body: "", truncated: true, originalLength: body.length };
	}

	if (options.maxChars < notice.length) {
		// Notice alone does not fit; surface it so the model can still discover
		// the full file location instead of receiving a silent empty body.
		return { body: notice, truncated: true, originalLength: body.length };
	}

	const sliceEnd = safeSliceEnd(body, options.maxChars - notice.length);
	return { body: `${body.slice(0, sliceEnd)}${notice}`, truncated: true, originalLength: body.length };
}

/**
 * Fit an ordered list of rule bodies into a shared char budget. Earlier
 * rules are kept whole whenever they fit; later rules are clipped (with a
 * notice) or dropped once the running total exceeds `maxResultChars`. The
 * returned array preserves the input order; rules that did not fit are
 * simply absent from the result.
 */
export function truncateBudget(options: TruncateBudgetOptions): TruncatedBudgetRule[] {
	const noticeTemplate = options.noticeTemplate ?? DEFAULT_TRUNCATION_NOTICE;
	const results: TruncatedBudgetRule[] = [];
	let remaining = options.maxResultChars;

	for (const rule of options.rules) {
		if (remaining <= 0) {
			break;
		}

		if (rule.body.length <= remaining) {
			results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
			remaining -= rule.body.length;
			continue;
		}

		const notice = renderNotice(noticeTemplate, rule.relativePath);
		if (remaining <= notice.length) {
			break;
		}

		const sliceEnd = safeSliceEnd(rule.body, remaining - notice.length);
		const body = `${rule.body.slice(0, sliceEnd)}${notice}`;
		results.push({ body, truncated: true, relativePath: rule.relativePath });
		remaining -= body.length;
	}

	return results;
}
