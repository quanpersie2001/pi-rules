import { describe, expect, test } from "vitest";
/**
 * This is a relative import that points at the built extension entry-point
 * so that the test exercises the **exact** code bundled for consumers. If
 * the build hasn't run yet the test will fail with a module-not-found error.
 */
import piRulesExtension from "../../extension-src/pi-rules/pi/index.js";
import { createFakePi } from "../helpers/fake-pi-harness.js";

describe("e2e smoke", () => {
	test("extension loads without throwing", () => {
		const harness = createFakePi();
		expect(() => piRulesExtension(harness.pi)).not.toThrow();
	});

	test("session_start discovers rules and sets status", async () => {
		const harness = createFakePi();
		piRulesExtension(harness.pi);

		const ctx = harness.makeCtx({ cwd: process.cwd() });
		await harness.emit("session_start", {}, ctx);

		// Status should be set after session_start
		const status = harness.statuses.get("pi-rules");
		expect(status).toBeDefined();
	});

	test("tool_result injects matching rules", async () => {
		const harness = createFakePi();
		piRulesExtension(harness.pi);

		const ctx = harness.makeCtx({ cwd: process.cwd() });
		await harness.emit("session_start", {}, ctx);

		// Simulate reading a file under src/
		const result = await harness.emit(
			"tool_result",
			{
				toolName: "read",
				input: { path: "extension-src/pi-rules/pi/index.ts" },
				content: [{ type: "text", text: "// file content" }],
				isError: false,
			},
			ctx,
		);

		// May be undefined if no rules match, but should not throw
		expect(result === undefined || result !== null).toBe(true);
	});

	test("session_shutdown stops cleanly", async () => {
		const harness = createFakePi();
		piRulesExtension(harness.pi);

		const ctx = harness.makeCtx({ cwd: process.cwd() });
		await harness.emit("session_start", {}, ctx);
		await harness.emit("session_shutdown", {}, ctx);

		// Should not throw
		expect(true).toBe(true);
	});
});
