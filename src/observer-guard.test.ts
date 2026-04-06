import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { shouldSkipPath, shouldSkipObservation } from "./observer-guard.js";

const LEARNING_BASE = join(homedir(), ".pi", "continuous-learning");

describe("observer-guard", () => {
  describe("shouldSkipPath", () => {
    it("returns true for paths under ~/.pi/continuous-learning/", () => {
      const path = join(
        LEARNING_BASE,
        "projects",
        "abc123",
        "observations.jsonl",
      );
      expect(shouldSkipPath(path)).toBe(true);
    });

    it("returns true for the base directory itself", () => {
      expect(shouldSkipPath(LEARNING_BASE)).toBe(true);
    });

    it("returns false for unrelated paths", () => {
      expect(shouldSkipPath("/home/user/projects/my-app/src/index.ts")).toBe(
        false,
      );
    });

    it("returns false for paths that start with a similar prefix but differ", () => {
      const unrelated = join(
        homedir(),
        ".pi",
        "continuous-learning-other",
        "file.txt",
      );
      expect(shouldSkipPath(unrelated)).toBe(false);
    });
  });

  describe("shouldSkipObservation", () => {
    it("returns false when no path given", () => {
      expect(shouldSkipObservation()).toBe(false);
    });

    it("returns true for filtered path", () => {
      const path = join(
        LEARNING_BASE,
        "instincts",
        "personal",
        "instinct-1.md",
      );
      expect(shouldSkipObservation(path)).toBe(true);
    });

    it("returns false for normal path", () => {
      expect(shouldSkipObservation("/home/user/projects/app/main.ts")).toBe(
        false,
      );
    });
  });
});
