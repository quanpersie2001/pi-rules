import { describeMatchReason } from "./matcher.js";
import { truncateRuleBody } from "./truncator.js";
import type { MatchedRule } from "./types.js";

export interface FormatOptions {
	maxRuleChars: number;
	maxContextChars: number;
}

export interface FormattedRuleContext {
	prompt: string;
	truncated: boolean;
}

/**
 * Separate matches into children (deeper paths) and parents (shallower paths).
 * A rule is a "parent" if its relativePath (without filename) is a prefix of
 * another rule's relativePath. Children are injected fully; parents get only
 * a summary paragraph.
 */
export function separateParentChild(matches: MatchedRule[]): { children: MatchedRule[]; parents: MatchedRule[] } {
	if (matches.length <= 1) return { children: matches, parents: [] };

	const pathDirs = matches.map((m) => {
		const normalized = m.relativePath.replaceAll("\\", "/");
		const lastSlash = normalized.lastIndexOf("/");
		return lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	});

	const isParent = new Array<boolean>(matches.length).fill(false);

	for (let i = 0; i < matches.length; i++) {
		for (let j = 0; j < matches.length; j++) {
			if (i === j) continue;
			// Rule i is a parent of rule j if rule i's directory is a prefix of rule j's path
			if (pathDirs[i]!.length > 0 && matches[j]!.relativePath.startsWith(pathDirs[i]!) && pathDirs[i] !== pathDirs[j]) {
				isParent[i] = true;
				break;
			}
		}
	}

	const children: MatchedRule[] = [];
	const parents: MatchedRule[] = [];
	for (let i = 0; i < matches.length; i++) {
		if (isParent[i]) {
			parents.push(matches[i]!);
		} else {
			children.push(matches[i]!);
		}
	}
	return { children, parents };
}

function extractFirstParagraph(body: string): string {
	const lines = body.split("\n");
	const paragraph: string[] = [];
	for (const line of lines) {
		if (line.trim() === "" && paragraph.length > 0) break;
		paragraph.push(line);
	}
	return paragraph.join("\n").trim();
}

export function formatRuleContext(matches: MatchedRule[], options: FormatOptions): FormattedRuleContext {
	if (matches.length === 0) {
		return { prompt: "", truncated: false };
	}

	// Separate rules from inventory
	const rulesMatches = matches.filter((m) => m.frontmatter.kind !== "inventory");
	const inventoryMatches = matches.filter((m) => m.frontmatter.kind === "inventory");

	// Group rules into parent/child for 2-tier injection
	const { children, parents } = separateParentChild(rulesMatches);

	const sections: string[] = [
		"<pi-rules-context>",
		"The following project rules apply to this turn. Follow them when working with matching files.",
	];
	let totalChars = sections.join("\n").length;
	let truncated = false;

	// Inject children fully
	for (const match of children) {
		const truncation = truncateRuleBody(match.body, {
			maxChars: options.maxRuleChars,
			relativePath: match.relativePath,
		});
		if (truncation.truncated) truncated = true;
		const block = [
			`## Rule: ${match.relativePath}`,
			`Matched because: ${describeMatchReason(match.matchReason)}`,
			match.frontmatter.summary ? `Summary: ${match.frontmatter.summary}` : undefined,
			"",
			truncation.body,
		]
			.filter((value) => value !== undefined)
			.join("\n");

		const projected = totalChars + block.length + 2;
		if (projected > options.maxContextChars) {
			truncated = true;
			break;
		}
		sections.push(block);
		totalChars = projected;
	}

	// Inject parents as summary only
	for (const match of parents) {
		const summaryText = match.frontmatter.summary ?? extractFirstParagraph(match.body);
		const block = [
			`## Rule: ${match.relativePath} (parent summary)`,
			`Matched because: ${describeMatchReason(match.matchReason)}`,
			`Summary: ${summaryText}`,
			"",
			"[Full rule available; read the file for complete details]",
		]
			.filter((value) => value !== undefined)
			.join("\n");

		const projected = totalChars + block.length + 2;
		if (projected > options.maxContextChars) {
			truncated = true;
			break;
		}
		sections.push(block);
		totalChars = projected;
	}

	// Inventory listing
	if (inventoryMatches.length > 0) {
		const invLines = ["## Available Inventories"];
		for (const inv of inventoryMatches) {
			const label = inv.frontmatter.summary ? ` (${inv.frontmatter.summary})` : "";
			invLines.push(`- ${inv.relativePath}${label}`);
		}
		const invBlock = invLines.join("\n");
		const projected = totalChars + invBlock.length + 2;
		if (projected <= options.maxContextChars) {
			sections.push(invBlock);
			totalChars = projected;
		} else {
			truncated = true;
		}
	}

	sections.push("</pi-rules-context>");
	return { prompt: sections.join("\n\n"), truncated };
}
