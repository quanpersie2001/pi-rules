import { beforeEach, describe, expect, it } from "vitest";
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

describe("pi-rules extension registration", () => {
	let harness: ReturnType<typeof createFakePi>;

	beforeEach(() => {
		harness = createFakePi();
		piRulesExtension(harness.pi);
	});

	it("registers exactly 5 flags with the expected names and defaults", () => {
		expect(harness.flags.size).toBe(5);

		const expectedFlags = [
			"pi-rules-disabled",
			"pi-rules-mode",
			"pi-rules-maintainer",
			"pi-rules-widget",
			"pi-rules-maintainer-concurrency",
		];
		for (const name of expectedFlags) {
			expect(harness.flags.has(name), `expected flag ${name} to be registered`).toBe(true);
		}

		expect(harness.pi.getFlag("pi-rules-disabled")).toBe(false);
		expect(harness.pi.getFlag("pi-rules-mode")).toBe("both");
		expect(harness.pi.getFlag("pi-rules-maintainer")).toBe(true);
		expect(harness.pi.getFlag("pi-rules-widget")).toBe(true);
		expect(harness.pi.getFlag("pi-rules-maintainer-concurrency")).toBe("1");
	});

	it("registers exactly 8 commands with the expected names", () => {
		expect(harness.commands).toHaveLength(8);

		const expectedCommands = [
			"pi-rules:init",
			"pi-rules:maintain",
			"pi-rules:status",
			"pi-rules:doctor",
			"pi-rules:context",
			"pi-rules:maintainer-status",
			"pi-rules:maintainer-log",
			"pi-rules:maintainer-kill",
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
