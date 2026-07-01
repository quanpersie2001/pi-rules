import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { DEFAULT_MAINTAINER_LOG_LINES, DEFAULT_MAX_CONTEXT_CHARS, DEFAULT_MAX_RULE_CHARS } from "./constants.js";

export type PiRulesMode = "static" | "dynamic" | "both" | "off";
export type PiRulesDynamicInjection = "off" | "full";

export interface PiRulesConfig {
	disabled: boolean;
	mode: PiRulesMode;
	recommendationEnabled: boolean;
	widgetEnabled: boolean;
	maxRuleChars: number;
	maxContextChars: number;
	maintainerLogLines: number;
	writeGuardEnabled: boolean;
	dynamicInjection: PiRulesDynamicInjection;
}

export const DEFAULT_CONFIG: PiRulesConfig = {
	disabled: false,
	mode: "both",
	recommendationEnabled: true,
	widgetEnabled: true,
	maxRuleChars: DEFAULT_MAX_RULE_CHARS,
	maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
	maintainerLogLines: DEFAULT_MAINTAINER_LOG_LINES,
	writeGuardEnabled: false,
	dynamicInjection: "full",
};

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<PiRulesConfig> {
	return {
		disabled: env.PI_RULES_DISABLED === "1" ? true : undefined,
		recommendationEnabled: env.PI_RULES_RECOMMENDATIONS_DISABLED === "1" ? false : undefined,
		maxRuleChars: parsePositiveInteger(env.PI_RULES_MAX_RULE_CHARS),
		maxContextChars: parsePositiveInteger(env.PI_RULES_MAX_CONTEXT_CHARS),
		maintainerLogLines: parsePositiveInteger(env.PI_RULES_MAINTAINER_LOG_LINES),
		writeGuardEnabled: parseBooleanFlag(env.PI_RULES_WRITE_GUARD),
		dynamicInjection: parseDynamicInjection(env.PI_RULES_DYNAMIC_INJECTION),
	};
}

export function readConfigFromFiles(projectRoot: string, homeDir = homedir()): Partial<PiRulesConfig> {
	return mergePartialConfigFiles(
		readConfigJsonFile(resolve(homeDir, ".pi/agent/pi-rules.json")),
		readConfigJsonFile(resolve(projectRoot, ".pi/pi-rules.json")),
	);
}

export function writeProjectConfigPatch(projectRoot: string, patch: Partial<PiRulesConfig>): string {
	const configPath = resolve(projectRoot, ".pi/pi-rules.json");
	const current = readJsonObject(configPath);
	const next = { ...current, ...sanitizeConfigPatch(patch) };
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return configPath;
}

export function mergeConfig(...parts: Array<Partial<PiRulesConfig>>): PiRulesConfig {
	const config: PiRulesConfig = { ...DEFAULT_CONFIG };
	for (const part of parts) {
		for (const [key, value] of Object.entries(part) as Array<
			[keyof PiRulesConfig, PiRulesConfig[keyof PiRulesConfig] | undefined]
		>) {
			if (value !== undefined) {
				config[key] = value as never;
			}
		}
	}
	return config;
}

function readJsonObject(path: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function sanitizeConfigPatch(patch: Partial<PiRulesConfig>): Partial<PiRulesConfig> {
	return normalizeConfigObject(patch) ?? {};
}

function mergePartialConfigFiles(...parts: Array<Partial<PiRulesConfig> | undefined>): Partial<PiRulesConfig> {
	const config: Partial<PiRulesConfig> = {};
	for (const part of parts) {
		if (part === undefined) continue;
		for (const [key, value] of Object.entries(part) as Array<
			[keyof PiRulesConfig, PiRulesConfig[keyof PiRulesConfig] | undefined]
		>) {
			if (value !== undefined) {
				config[key] = value as never;
			}
		}
	}
	return config;
}

function readConfigJsonFile(path: string): Partial<PiRulesConfig> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
	return normalizeConfigObject(parsed);
}

function normalizeConfigObject(value: unknown): Partial<PiRulesConfig> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	return {
		disabled: typeof input.disabled === "boolean" ? input.disabled : undefined,
		mode: isMode(input.mode) ? input.mode : undefined,
		recommendationEnabled: typeof input.recommendationEnabled === "boolean" ? input.recommendationEnabled : undefined,
		widgetEnabled: typeof input.widgetEnabled === "boolean" ? input.widgetEnabled : undefined,
		maxRuleChars: typeof input.maxRuleChars === "number" && input.maxRuleChars > 0 ? input.maxRuleChars : undefined,
		maxContextChars:
			typeof input.maxContextChars === "number" && input.maxContextChars > 0 ? input.maxContextChars : undefined,
		maintainerLogLines:
			typeof input.maintainerLogLines === "number" && input.maintainerLogLines > 0
				? input.maintainerLogLines
				: undefined,
		writeGuardEnabled: typeof input.writeGuardEnabled === "boolean" ? input.writeGuardEnabled : undefined,
		dynamicInjection: parseDynamicInjection(
			typeof input.dynamicInjection === "string" ? input.dynamicInjection : undefined,
		),
	};
}

function isMode(value: unknown): value is PiRulesMode {
	return value === "static" || value === "dynamic" || value === "both" || value === "off";
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	return value === "1" || value.toLowerCase() === "true";
}

function parseDynamicInjection(value: string | undefined): PiRulesDynamicInjection | undefined {
	return value === "off" || value === "full" ? value : undefined;
}
