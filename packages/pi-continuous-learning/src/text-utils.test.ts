import { describe, it, expect } from "vitest";
import { normalizeRelativeDates } from "./text-utils.js";

const NOW = new Date("2026-04-06T12:00:00Z");

describe("normalizeRelativeDates", () => {
  it("replaces 'today'", () => {
    expect(normalizeRelativeDates("Today we fixed it", NOW)).toBe(
      "2026-04-06 we fixed it",
    );
  });

  it("replaces 'this morning'", () => {
    expect(normalizeRelativeDates("This morning the build broke", NOW)).toBe(
      "2026-04-06 the build broke",
    );
  });

  it("replaces 'yesterday'", () => {
    expect(normalizeRelativeDates("Yesterday's refactor showed X", NOW)).toBe(
      "2026-04-05's refactor showed X",
    );
  });

  it("replaces 'last week'", () => {
    expect(normalizeRelativeDates("Last week we discovered this", NOW)).toBe(
      "week of 2026-03-30 we discovered this",
    );
  });

  it("replaces 'N days ago' (singular)", () => {
    expect(normalizeRelativeDates("1 day ago the test failed", NOW)).toBe(
      "2026-04-05 the test failed",
    );
  });

  it("replaces 'N days ago' (plural)", () => {
    expect(normalizeRelativeDates("3 days ago we merged this", NOW)).toBe(
      "2026-04-03 we merged this",
    );
  });

  it("is case-insensitive", () => {
    expect(normalizeRelativeDates("YESTERDAY we saw this", NOW)).toBe(
      "2026-04-05 we saw this",
    );
  });

  it("replaces multiple occurrences in one string", () => {
    const result = normalizeRelativeDates(
      "Yesterday we started, today we finished",
      NOW,
    );
    expect(result).toBe("2026-04-05 we started, 2026-04-06 we finished");
  });

  it("leaves strings without relative dates unchanged", () => {
    const text = "Session abc123: the refactor improved performance";
    expect(normalizeRelativeDates(text, NOW)).toBe(text);
  });

  it("does not replace partial word matches", () => {
    const text = "everyday patterns matter";
    expect(normalizeRelativeDates(text, NOW)).toBe(text);
  });
});
