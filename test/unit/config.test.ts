import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeConfig, readConfigFromEnv, readConfigFromFiles } from "../../extension-src/pi-rules/app/config.js";

const tempDirs: string[] = [];

function makeTempDir(label: string): string {
	const dir = mkdtempSync(resolve(tmpdir(), `pi-rules-config-${label}-`));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe("pi-rules config", () => {
	it("loads global and project config files with project overriding global", () => {
		const homeDir = makeTempDir("home");
		const projectDir = makeTempDir("project");
		mkdirSync(resolve(homeDir, ".pi/agent"), { recursive: true });
		mkdirSync(resolve(projectDir, ".pi"), { recursive: true });
		writeFileSync(
			resolve(homeDir, ".pi/agent/pi-rules.json"),
			JSON.stringify({ mode: "dynamic", dynamicInjection: "full", writeGuardEnabled: false }),
		);
		writeFileSync(
			resolve(projectDir, ".pi/pi-rules.json"),
			JSON.stringify({ mode: "static", dynamicInjection: "off", writeGuardEnabled: true }),
		);

		const config = readConfigFromFiles(projectDir, homeDir);

		expect(config).toEqual(
			expect.objectContaining({
				mode: "static",
				dynamicInjection: "off",
				writeGuardEnabled: true,
			}),
		);
	});

	it("merges defaults, files, env, and flags in precedence order", () => {
		const merged = mergeConfig(
			{ mode: "dynamic", writeGuardEnabled: false, dynamicInjection: "full" },
			readConfigFromEnv({ PI_RULES_WRITE_GUARD: "1", PI_RULES_DYNAMIC_INJECTION: "off" } as NodeJS.ProcessEnv),
			{ mode: "static" },
		);

		expect(merged.mode).toBe("static");
		expect(merged.writeGuardEnabled).toBe(true);
		expect(merged.dynamicInjection).toBe("off");
	});

	it("ignores missing or invalid config files", () => {
		const homeDir = makeTempDir("missing-home");
		const projectDir = makeTempDir("invalid-project");
		mkdirSync(resolve(projectDir, ".pi"), { recursive: true });
		writeFileSync(resolve(projectDir, ".pi/pi-rules.json"), "not json");

		expect(readConfigFromFiles(projectDir, homeDir)).toEqual({});
	});
});
