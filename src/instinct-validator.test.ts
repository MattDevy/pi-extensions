import { describe, it, expect } from "vitest";
import { validateInstinct } from "./instinct-validator.js";

describe("validateInstinct", () => {
  const validFields = {
    action: "Read the file before making any edits to understand context",
    trigger: "Before making edits to an existing file",
  };

  it("accepts valid action and trigger", () => {
    expect(validateInstinct(validFields)).toEqual({ valid: true });
  });

  describe("rejects invalid action", () => {
    it("rejects undefined action", () => {
      const result = validateInstinct({ ...validFields, action: undefined });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
      expect(result.reason).toContain("undefined");
    });

    it("rejects null action", () => {
      const result = validateInstinct({ ...validFields, action: null });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects empty string action", () => {
      const result = validateInstinct({ ...validFields, action: "" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects literal 'undefined' string", () => {
      const result = validateInstinct({ ...validFields, action: "undefined" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
      expect(result.reason).toContain("undefined");
    });

    it("rejects literal 'null' string", () => {
      const result = validateInstinct({ ...validFields, action: "null" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects literal 'none' string (case-insensitive)", () => {
      const result = validateInstinct({ ...validFields, action: "None" });
      expect(result.valid).toBe(false);
    });

    it("rejects action shorter than 10 characters", () => {
      const result = validateInstinct({ ...validFields, action: "Do stuff" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too short");
    });

    it("rejects whitespace-only action", () => {
      const result = validateInstinct({ ...validFields, action: "   " });
      expect(result.valid).toBe(false);
    });

    it("rejects non-string action", () => {
      const result = validateInstinct({ ...validFields, action: 42 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not a string");
    });
  });

  describe("rejects invalid trigger", () => {
    it("rejects undefined trigger", () => {
      const result = validateInstinct({ ...validFields, trigger: undefined });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("trigger");
    });

    it("rejects literal 'undefined' trigger", () => {
      const result = validateInstinct({ ...validFields, trigger: "undefined" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("trigger");
    });

    it("rejects trigger shorter than 10 characters", () => {
      const result = validateInstinct({ ...validFields, trigger: "When X" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too short");
    });
  });

  it("checks action before trigger (action error takes priority)", () => {
    const result = validateInstinct({ action: "undefined", trigger: "undefined" });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("action");
  });
});
