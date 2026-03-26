import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { parseAnalyzerStream, parseEventLine } from "./analyzer-stream.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a Readable stream from a list of NDJSON lines. */
function makeStream(lines: string[]): Readable {
  return Readable.from(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// parseEventLine
// ---------------------------------------------------------------------------

describe("parseEventLine", () => {
  it("parses a valid JSON line", () => {
    const result = parseEventLine('{"event":"agent_end"}');
    expect(result).toEqual({ event: "agent_end" });
  });

  it("returns null for an empty line", () => {
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
  });

  it("returns null and logs warning for malformed JSON", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const result = parseEventLine("{not valid json}");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Malformed JSON line")
    );
    warnSpy.mockRestore();
  });

  it("trims whitespace before parsing", () => {
    const result = parseEventLine('  {"event":"agent_end"}  ');
    expect(result).toEqual({ event: "agent_end" });
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - success detection
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - success detection", () => {
  it("sets success=true when agent_end event is present", async () => {
    const stream = makeStream(['{"event":"agent_end"}']);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(true);
  });

  it("sets success=false when no agent_end event is present", async () => {
    const stream = makeStream(['{"event":"tool_execution_end","tool":"write","args":{"path":"/a.md"}}']);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(false);
  });

  it("supports type key as alternative to event key for agent_end", async () => {
    const stream = makeStream(['{"type":"agent_end"}']);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(true);
  });

  it("returns success=false for an empty stream", async () => {
    const stream = makeStream([]);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(false);
    expect(result.filesWritten).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - files written detection
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - files written", () => {
  it("records file path from a write tool_execution_end event", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{"path":"/tmp/instinct.md"}}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/tmp/instinct.md"]);
  });

  it("records multiple files from multiple write events", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{"path":"/a.md"}}',
      '{"event":"tool_execution_end","tool":"write","args":{"path":"/b.md"}}',
      '{"event":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/a.md", "/b.md"]);
    expect(result.success).toBe(true);
  });

  it("ignores non-write tool_execution_end events for file tracking", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"read","args":{"path":"/obs.jsonl"}}',
      '{"event":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
  });

  it("falls back to file_path arg key", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{"file_path":"/alt/path.md"}}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/alt/path.md"]);
  });

  it("falls back to filename arg key", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{"filename":"/alt/fname.md"}}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/alt/fname.md"]);
  });

  it("ignores write event with no path in args", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{}}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
  });

  it("ignores write event with missing args", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - error collection
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - error collection", () => {
  it("collects string error from tool event with error field", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","error":"Permission denied"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toEqual(["Permission denied"]);
  });

  it("collects generic error message when error=true", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","error":true}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("write");
  });

  it("collects error when is_error=true", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"read","is_error":true}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toHaveLength(1);
  });

  it("collects multiple errors across events", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","error":"Disk full"}',
      '{"event":"tool_execution_end","tool":"read","error":"Not found"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toEqual(["Disk full", "Not found"]);
  });

  it("does not collect error when error field is absent", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_end","tool":"write","args":{"path":"/ok.md"}}',
      '{"event":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - malformed line handling
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - malformed lines", () => {
  it("skips malformed JSON lines and continues parsing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const stream = makeStream([
      "{broken json",
      '{"event":"agent_end"}',
      "another bad line !!!",
    ]);
    const result = await parseAnalyzerStream(stream);

    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("skips blank lines silently without warning", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const stream = makeStream(["", "   ", '{"event":"agent_end"}', ""]);
    const result = await parseAnalyzerStream(stream);

    expect(result.success).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - combined result
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - combined result", () => {
  it("returns complete AnalysisResult with all fields populated", async () => {
    const stream = makeStream([
      '{"event":"tool_execution_start","tool":"read","args":{"path":"/obs.jsonl"}}',
      '{"event":"tool_execution_end","tool":"read","args":{"path":"/obs.jsonl"}}',
      '{"event":"tool_execution_start","tool":"write","args":{"path":"/inst/new-pattern.md"}}',
      '{"event":"tool_execution_end","tool":"write","args":{"path":"/inst/new-pattern.md"}}',
      '{"event":"tool_execution_start","tool":"write","args":{"path":"/inst/old-pattern.md"}}',
      '{"event":"tool_execution_end","tool":"write","error":"Read-only filesystem"}',
      '{"event":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(["/inst/new-pattern.md"]);
    expect(result.errors).toEqual(["Read-only filesystem"]);
  });
});
