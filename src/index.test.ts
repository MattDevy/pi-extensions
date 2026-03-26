import { describe, it, expect } from "vitest";
import extension from "./index.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("extension entry point", () => {
	it("exports a default function", () => {
		expect(typeof extension).toBe("function");
	});

	it("accepts ExtensionAPI and returns void (no-op)", () => {
		const mockApi = {} as ExtensionAPI;
		const result = extension(mockApi);
		expect(result).toBeUndefined();
	});

	it("does not throw when called", () => {
		const mockApi = {} as ExtensionAPI;
		expect(() => extension(mockApi)).not.toThrow();
	});
});
