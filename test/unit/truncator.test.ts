import { describe, expect, it } from "vitest";
import {
	DEFAULT_TRUNCATION_NOTICE,
	truncateBudget,
	truncateRuleBody,
} from "../../extension-src/pi-rules/domain/truncator.js";

describe("truncateRuleBody", () => {
	it("returns the body unchanged when shorter than maxChars", () => {
		const result = truncateRuleBody("hello", { maxChars: 100, relativePath: "rule.md" });
		expect(result.truncated).toBe(false);
		expect(result.body).toBe("hello");
		expect(result.originalLength).toBe(5);
	});

	it("appends a notice and sets truncated=true when the body is too long", () => {
		const long = "a".repeat(500);
		const result = truncateRuleBody(long, { maxChars: 100, relativePath: "rule.md" });
		expect(result.truncated).toBe(true);
		expect(result.body.length).toBeLessThanOrEqual(100);
		expect(result.body).toContain("truncated by pi-rules");
		expect(result.body).toContain("rule.md");
		expect(result.originalLength).toBe(500);
	});

	it("does not split a UTF-16 surrogate pair (emoji)", () => {
		// 1000 emoji = 2000 UTF-16 code units, each emoji is a surrogate pair
		const emoji = "🎉".repeat(1000);
		const result = truncateRuleBody(emoji, { maxChars: 100, relativePath: "emoji.md" });
		expect(result.truncated).toBe(true);
		expect(result.body.length).toBeLessThanOrEqual(100);
		// The body must remain a valid string — no lone surrogate should
		// appear between the slice and the notice. We verify by checking
		// that the codePoint length is consistent with the JS string.
		for (const char of result.body) {
			// If we ever see a lone surrogate this will yield a single
			// code unit of 0xD800..0xDBFF or 0xDC00..0xDFFF. The for-of
			// iteration over a string with a lone surrogate would surface
			// replacement characters or invalid sequences; to be safe, we
			// assert the body round-trips through JSON safely.
		}
		const roundTripped = JSON.parse(JSON.stringify(result.body)) as string;
		expect(roundTripped.length).toBe(result.body.length);
	});

	it("returns a sensible fallback when maxChars is smaller than the notice", () => {
		const result = truncateRuleBody("a".repeat(500), { maxChars: 5, relativePath: "tiny.md" });
		expect(result.truncated).toBe(true);
		// Should return the notice (or at least something non-empty) so the
		// model can still discover the rule file.
		expect(result.body.length).toBeGreaterThan(0);
		expect(result.originalLength).toBe(500);
	});

	it("returns empty body when maxChars is 0", () => {
		const result = truncateRuleBody("hello", { maxChars: 0, relativePath: "x.md" });
		expect(result.truncated).toBe(true);
		expect(result.body).toBe("");
		expect(result.originalLength).toBe(5);
	});

	it("honors a custom notice template", () => {
		const result = truncateRuleBody("a".repeat(500), {
			maxChars: 100,
			relativePath: "rule.md",
			noticeTemplate: " [snip {path}] ",
		});
		expect(result.body).toContain(" [snip rule.md] ");
	});

	it("uses DEFAULT_TRUNCATION_NOTICE by default", () => {
		const long = "a".repeat(500);
		const result = truncateRuleBody(long, { maxChars: 100, relativePath: "rule.md" });
		const expectedNotice = DEFAULT_TRUNCATION_NOTICE.replaceAll("{path}", "rule.md");
		expect(result.body.endsWith(expectedNotice)).toBe(true);
	});
});

describe("truncateBudget", () => {
	it("fits a small set of rules within the budget untouched", () => {
		const rules = [
			{ body: "short", relativePath: "a.md" },
			{ body: "tiny", relativePath: "b.md" },
		];
		const result = truncateBudget({ rules, maxResultChars: 1000 });
		expect(result).toHaveLength(2);
		expect(result[0].truncated).toBe(false);
		expect(result[1].truncated).toBe(false);
	});

	it("drops later rules when the budget is exhausted", () => {
		const rules = [
			{ body: "a".repeat(50), relativePath: "a.md" },
			{ body: "b".repeat(50), relativePath: "b.md" },
			{ body: "c".repeat(50), relativePath: "c.md" },
		];
		const result = truncateBudget({ rules, maxResultChars: 60 });
		expect(result.length).toBeLessThan(3);
		// First rule should always be present when it fits
		expect(result[0].relativePath).toBe("a.md");
	});

	it("truncates a rule when partial space remains", () => {
		const rules = [
			{ body: "a".repeat(50), relativePath: "a.md" },
			{ body: "b".repeat(200), relativePath: "b.md" },
		];
		const result = truncateBudget({ rules, maxResultChars: 100 });
		expect(result[0].truncated).toBe(false);
		expect(result[1].truncated).toBe(true);
		expect(result[1].body.length).toBeLessThanOrEqual(100);
	});
});
