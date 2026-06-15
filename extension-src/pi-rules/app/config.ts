import {
	DEFAULT_MAINTAINER_CONCURRENCY,
	DEFAULT_MAINTAINER_LOG_LINES,
	DEFAULT_MAX_CONTEXT_CHARS,
	DEFAULT_MAX_RULE_CHARS,
} from "./constants.js";

export type PiRulesMode = "static" | "dynamic" | "both" | "off";

export interface PiRulesConfig {
	disabled: boolean;
	mode: PiRulesMode;
	maintainerEnabled: boolean;
	widgetEnabled: boolean;
	maintainerConcurrency: number;
	maxRuleChars: number;
	maxContextChars: number;
	maintainerLogLines: number;
}

export const DEFAULT_CONFIG: PiRulesConfig = {
	disabled: false,
	mode: "both",
	maintainerEnabled: true,
	widgetEnabled: true,
	maintainerConcurrency: DEFAULT_MAINTAINER_CONCURRENCY,
	maxRuleChars: DEFAULT_MAX_RULE_CHARS,
	maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
	maintainerLogLines: DEFAULT_MAINTAINER_LOG_LINES,
};

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<PiRulesConfig> {
	return {
		disabled: env.PI_RULES_DISABLED === "1",
		maintainerEnabled: env.PI_RULES_MAINTAINER_DISABLED === "1" ? false : undefined,
		maxRuleChars: parsePositiveInteger(env.PI_RULES_MAX_RULE_CHARS),
		maxContextChars: parsePositiveInteger(env.PI_RULES_MAX_CONTEXT_CHARS),
		maintainerLogLines: parsePositiveInteger(env.PI_RULES_MAINTAINER_LOG_LINES),
	};
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

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
