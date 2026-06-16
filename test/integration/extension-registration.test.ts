import { beforeEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

describe("pi-rules extension registration", () => {
	let harness: ReturnType<typeof createFakePi>;

	beforeEach(() => {
		harness = createFakePi();
		piRulesExtension(harness.pi);
	});

	it("registers exactly 4 flags with the expected names and defaults", () => {
		expect(harness.flags.size).toBe(4);

		const expectedFlags = ["pi-rules-disabled", "pi-rules-mode", "pi-rules-recommendations", "pi-rules-widget"];
		for (const name of expectedFlags) {
			expect(harness.flags.has(name), `expected flag ${name} to be registered`).toBe(true);
		}

		expect(harness.pi.getFlag("pi-rules-disabled")).toBe(false);
		expect(harness.pi.getFlag("pi-rules-mode")).toBe("both");
		expect(harness.pi.getFlag("pi-rules-recommendations")).toBe(true);
		expect(harness.pi.getFlag("pi-rules-widget")).toBe(true);
	});

	it("registers exactly 11 commands with the expected names", () => {
		expect(harness.commands).toHaveLength(11);

		const expectedCommands = [
			"pi-rules:init",
			"pi-rules:maintain",
			"pi-rules:status",
			"pi-rules:doctor",
			"pi-rules:context",
			"pi-rules:approve",
			"pi-rules:approve-all",
			"pi-rules:cancel",
			"pi-rules:cancel-all",
			"pi-rules:cleanup",
			"pi-rules:recommendations-log",
		];
		const actualNames = harness.commands.map((c) => c.name).sort();
		expect(actualNames).toEqual([...expectedCommands].sort());

		for (const cmd of harness.commands) {
			expect(cmd.options.description, `${cmd.name} should have a description`).toBeTypeOf("string");
			expect(cmd.options.handler, `${cmd.name} should have a handler`).toBeInstanceOf(Function);
		}
	});

	it("registers exactly 1 tool named 'create_rule'", () => {
		expect(harness.tools).toHaveLength(1);
		expect(harness.tools[0]?.name).toBe("create_rule");
	});
});
