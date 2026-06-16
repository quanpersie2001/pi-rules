import { resolve } from "node:path";
import { fileStatFingerprint, listFilesRecursive, readTextFile, resolveRealPath } from "../shared/fs.js";
import { sha256 } from "../shared/hash.js";
import { isSubPath, normalizePath } from "../shared/path.js";
import { findProjectRoot } from "./project-root.js";
import type { RuleDiagnostic, RuleFile, RuleScanResult } from "./types.js";

export async function scanRuleFiles(cwd: string): Promise<RuleScanResult> {
	const projectRoot = findProjectRoot(cwd) ?? cwd;
	const rulesDir = resolve(projectRoot, ".pi/rules");
	const diagnostics: RuleDiagnostic[] = [];
	const files = await listFilesRecursive(rulesDir);
	const ruleFiles: RuleFile[] = [];
	const seenRealpaths = new Set<string>();

	for (const absolutePath of files) {
		if (!absolutePath.endsWith(".md")) continue;
		if (!isSubPath(rulesDir, absolutePath)) continue;
		if (normalizePath(absolutePath).includes("/.pi/.pi-rules/")) continue;
		const realPath = await resolveRealPath(absolutePath);
		// Deduplicate symlinked rules by realpath
		if (seenRealpaths.has(realPath)) continue;
		seenRealpaths.add(realPath);
		const fingerprint = fileStatFingerprint(absolutePath);
		if (fingerprint === "missing") {
			diagnostics.push({ severity: "warning", rulePath: absolutePath, message: "Unable to stat rule file" });
			continue;
		}
		const content = await readTextFile(absolutePath);
		if (content === undefined) {
			diagnostics.push({ severity: "warning", rulePath: absolutePath, message: "Unable to read rule file" });
			continue;
		}
		ruleFiles.push({
			absolutePath,
			realPath,
			relativePath: normalizePath(absolutePath.slice(projectRoot.length + 1)),
			ruleId: sha256(realPath),
			contentHash: sha256(content),
			fingerprint,
		});
	}

	ruleFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
	return { projectRoot, rulesDir, ruleFiles, diagnostics };
}
