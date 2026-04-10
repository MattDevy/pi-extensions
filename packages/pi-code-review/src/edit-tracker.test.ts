import { describe, it, expect } from "vitest";
import { createEditTracker } from "./edit-tracker.js";

describe("createEditTracker", () => {
  it("tracks Write tool edits", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { file_path: "src/foo.ts" });

    tracker.onTurnEnd(0);
    const edits = tracker.getLastTurnEdits();
    expect(edits).toEqual({
      files: [{ path: "src/foo.ts", language: "typescript" }],
      turnIndex: 0,
    });
  });

  it("tracks Edit tool edits", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Edit", { file_path: "src/bar.py" });

    tracker.onTurnEnd(1);
    const edits = tracker.getLastTurnEdits();
    expect(edits).toEqual({
      files: [{ path: "src/bar.py", language: "python" }],
      turnIndex: 1,
    });
  });

  it("extracts path from result.path field", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { path: "main.go" });

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()?.files).toEqual([
      { path: "main.go", language: "go" },
    ]);
  });

  it("extracts path from string result via regex", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Edit", "File: src/lib.rs updated successfully");

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()?.files).toEqual([
      { path: "src/lib.rs", language: "rust" },
    ]);
  });

  it("deduplicates files edited multiple times in a turn", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Edit", { file_path: "src/foo.ts" });
    tracker.trackEdit("Edit", { file_path: "src/foo.ts" });
    tracker.trackEdit("Write", { file_path: "src/foo.ts" });

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()?.files).toHaveLength(1);
  });

  it("tracks multiple different files", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { file_path: "src/a.ts" });
    tracker.trackEdit("Edit", { file_path: "src/b.py" });
    tracker.trackEdit("Write", { file_path: "src/c.go" });

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()?.files).toHaveLength(3);
  });

  it("ignores non-Write/Edit tools", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Bash", { stdout: "ok" });
    tracker.trackEdit("Read", { file_path: "src/foo.ts" });

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()).toBeNull();
  });

  it("ignores non-code files", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { file_path: "package.json" });
    tracker.trackEdit("Edit", { file_path: "README.md" });

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()).toBeNull();
  });

  it("clears accumulator after onTurnEnd", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { file_path: "src/foo.ts" });
    tracker.onTurnEnd(0);

    tracker.trackEdit("Write", { file_path: "src/bar.ts" });
    tracker.onTurnEnd(1);

    const edits = tracker.getLastTurnEdits();
    expect(edits?.files).toEqual([{ path: "src/bar.ts", language: "typescript" }]);
    expect(edits?.turnIndex).toBe(1);
  });

  it("returns null when no edits in last turn", () => {
    const tracker = createEditTracker();

    tracker.onTurnEnd(0);

    expect(tracker.getLastTurnEdits()).toBeNull();
  });

  it("clearLastTurnEdits removes snapshot", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", { file_path: "src/foo.ts" });
    tracker.onTurnEnd(0);
    tracker.clearLastTurnEdits();

    expect(tracker.getLastTurnEdits()).toBeNull();
  });

  it("handles null/undefined result gracefully", () => {
    const tracker = createEditTracker();

    tracker.trackEdit("Write", null);
    tracker.trackEdit("Edit", undefined);

    tracker.onTurnEnd(0);
    expect(tracker.getLastTurnEdits()).toBeNull();
  });
});
