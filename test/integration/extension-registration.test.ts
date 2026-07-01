import { beforeEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

describe("pi-rules extension registration", () => {
	let harness: ReturnType<typeof createFakePi>;

	beforeEach(() => {
		harness = createFakePi();
		piRulesExtension(harness.pi);
	});

	it("registers exactly 6 flags with the expected names and defaults", () => {
		expect(harness.flags.size).toBe(6);

		const expectedFlags = [
			"pi-rules-disabled",
			"pi-rules-mode",
			"pi-rules-recommendations",
			"pi-rules-widget",
			"pi-rules-write-guard",
			"pi-rules-dynamic-injection",
		];
		for (const name of expectedFlags) {
			expect(harness.flags.has(name), `expected flag ${name} to be registered`).toBe(true);
		}

		expect(harness.pi.getFlag("pi-rules-disabled")).toBe(false);
		expect(harness.pi.getFlag("pi-rules-mode")).toBe("both");
		expect(harness.pi.getFlag("pi-rules-recommendations")).toBe(true);
		expect(harness.pi.getFlag("pi-rules-widget")).toBe(true);
		expect(harness.pi.getFlag("pi-rules-write-guard")).toBe(false);
		expect(harness.pi.getFlag("pi-rules-dynamic-injection")).toBe("full");
	});

	it("registers exactly 7 commands with the expected names", () => {
		expect(harness.commands).toHaveLength(7);

		const expectedCommands = [
			"pi-rules:init",
			"pi-rules:status",
			"pi-rules:mode",
			"pi-rules:write-guard",
			"pi-rules:doctor",
			"pi-rules:context",
			"pi-rules:cleanup",
		];
		const actualNames = harness.commands.map((c) => c.name).sort();
		expect(actualNames).toEqual([...expectedCommands].sort());

		for (const cmd of harness.commands) {
			expect(cmd.options.description, `${cmd.name} should have a description`).toBeTypeOf("string");
			expect(cmd.options.handler, `${cmd.name} should have a handler`).toBeInstanceOf(Function);
		}
	});

	it("registers exactly 2 tools named 'pi_rules_recommend' and 'create_rule'", () => {
		expect(harness.tools).toHaveLength(2);
		const names = harness.tools.map((t) => t.name).sort();
		expect(names).toEqual(["create_rule", "pi_rules_recommend"]);
	});
});
