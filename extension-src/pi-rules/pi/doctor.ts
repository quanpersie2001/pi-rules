import type { RuntimeDeps } from "./runtime.js";

export interface DoctorResult {
	ruleCount: number;
	errorCount: number;
	lines: string[];
}

export async function runDoctor(cwd: string, runtimeDeps: RuntimeDeps): Promise<DoctorResult> {
	const status = await runtimeDeps.engine.getStatus(cwd);
	const errorCount = status.diagnostics.filter((d) => d.severity === "error").length;
	const ok = errorCount === 0;

	const header = ok
		? `pi-rules doctor: OK (${status.ruleCount} rules)`
		: `pi-rules doctor: ERRORS (${status.ruleCount} rules, ${errorCount} errors)`;

	const lines = [header, `Project root: ${status.projectRoot}`, `Rules dir: ${status.rulesDir}`, ""];

	for (const rule of status.rules) {
		const paths = Array.isArray(rule.frontmatter.paths)
			? rule.frontmatter.paths.join(", ")
			: (rule.frontmatter.paths ?? "always");
		const kind = rule.frontmatter.kind ?? "rules";
		const priority = rule.frontmatter.priority ?? 0;
		const summary = rule.frontmatter.summary ?? rule.frontmatter.description ?? "";
		lines.push(`  ${rule.relativePath}`);
		lines.push(`    summary  : ${summary}`);
		lines.push(`    paths    : ${paths}`);
		lines.push(`    kind     : ${kind}`);
		lines.push(`    priority : ${priority}`);
		lines.push("");
	}

	if (status.diagnostics.length > 0) {
		lines.push("--- Diagnostics ---");
		for (const diag of status.diagnostics) {
			const prefix = diag.severity === "error" ? "ERR" : "WARN";
			lines.push(`  [${prefix}] ${diag.rulePath ?? "?"}: ${diag.message}`);
		}
	}

	return { ruleCount: status.ruleCount, errorCount, lines };
}
