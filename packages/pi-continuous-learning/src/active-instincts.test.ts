import { describe, it, expect, beforeEach } from "vitest";
import {
  getCurrentActiveInstincts,
  setCurrentActiveInstincts,
  clearActiveInstincts,
} from "./active-instincts.js";

describe("active-instincts", () => {
  beforeEach(() => {
    clearActiveInstincts();
  });

  it("returns empty array by default", () => {
    expect(getCurrentActiveInstincts()).toEqual([]);
  });

  it("sets and gets active instinct IDs", () => {
    setCurrentActiveInstincts(["instinct-a", "instinct-b"]);
    expect(getCurrentActiveInstincts()).toEqual(["instinct-a", "instinct-b"]);
  });

  it("replaces previous state on set", () => {
    setCurrentActiveInstincts(["old-instinct"]);
    setCurrentActiveInstincts(["new-instinct-1", "new-instinct-2"]);
    expect(getCurrentActiveInstincts()).toEqual([
      "new-instinct-1",
      "new-instinct-2",
    ]);
  });

  it("clears active instincts to empty array", () => {
    setCurrentActiveInstincts(["instinct-a"]);
    clearActiveInstincts();
    expect(getCurrentActiveInstincts()).toEqual([]);
  });

  it("returns a copy - mutations do not affect internal state", () => {
    setCurrentActiveInstincts(["instinct-a"]);
    const result = getCurrentActiveInstincts();
    result.push("injected");
    expect(getCurrentActiveInstincts()).toEqual(["instinct-a"]);
  });

  it("set with empty array results in empty state", () => {
    setCurrentActiveInstincts(["instinct-a"]);
    setCurrentActiveInstincts([]);
    expect(getCurrentActiveInstincts()).toEqual([]);
  });
});
