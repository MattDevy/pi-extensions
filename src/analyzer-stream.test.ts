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

/** Real Pi JSON-mode event format helpers. */
function startEvent(toolCallId: string, toolName: string, args: Record<string, unknown>): string {
  return JSON.stringify({ type: "tool_execution_start", toolCallId, toolName, args });
}

function endEvent(toolCallId: string, toolName: string, isError = false): string {
  return JSON.stringify({ type: "tool_execution_end", toolCallId, toolName, isError });
}

// ---------------------------------------------------------------------------
// parseEventLine
// ---------------------------------------------------------------------------

describe("parseEventLine", () => {
  it("parses a valid JSON line", () => {
    const result = parseEventLine('{"type":"agent_end"}');
    expect(result).toEqual({ type: "agent_end" });
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
    const result = parseEventLine('  {"type":"agent_end"}  ');
    expect(result).toEqual({ type: "agent_end" });
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - success detection
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - success detection", () => {
  it("sets success=true when type:agent_end event is present", async () => {
    const stream = makeStream(['{"type":"agent_end"}']);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(true);
  });

  it("sets success=false when no agent_end event is present", async () => {
    const stream = makeStream([
      startEvent("id-1", "write", { path: "/a.md" }),
      endEvent("id-1", "write"),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.success).toBe(false);
  });

  it("supports legacy event key as alternative to type key for agent_end", async () => {
    const stream = makeStream(['{"event":"agent_end"}']);
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
// parseAnalyzerStream - files written detection (real Pi format)
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - files written (real Pi format)", () => {
  it("records file path by correlating start args with end toolCallId", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/tmp/instinct.md" }),
      endEvent("call-1", "write"),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/tmp/instinct.md"]);
    expect(result.success).toBe(true);
  });

  it("records multiple files from multiple write pairs", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/a.md" }),
      endEvent("call-1", "write"),
      startEvent("call-2", "write", { path: "/b.md" }),
      endEvent("call-2", "write"),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/a.md", "/b.md"]);
    expect(result.success).toBe(true);
  });

  it("ignores read tool calls for file tracking", async () => {
    const stream = makeStream([
      startEvent("call-1", "read", { path: "/obs.jsonl" }),
      endEvent("call-1", "read"),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
  });

  it("does not record write when end event signals error", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/a.md" }),
      endEvent("call-1", "write", true),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("handles interleaved read and write calls correctly", async () => {
    const stream = makeStream([
      startEvent("r-1", "read", { path: "/obs.jsonl" }),
      startEvent("w-1", "write", { path: "/instinct-a.md" }),
      endEvent("r-1", "read"),
      endEvent("w-1", "write"),
      startEvent("w-2", "write", { path: "/instinct-b.md" }),
      endEvent("w-2", "write"),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/instinct-a.md", "/instinct-b.md"]);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("falls back to file_path arg key", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { file_path: "/alt/path.md" }),
      endEvent("call-1", "write"),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/alt/path.md"]);
  });

  it("falls back to filename arg key", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { filename: "/alt/fname.md" }),
      endEvent("call-1", "write"),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/alt/fname.md"]);
  });

  it("ignores write start event with no path in args", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", {}),
      endEvent("call-1", "write"),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - files written (legacy format fallback)
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - files written (legacy format)", () => {
  it("falls back to args on end event when no start event was seen", async () => {
    const stream = makeStream([
      '{"type":"tool_execution_end","tool":"write","args":{"path":"/legacy.md"}}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/legacy.md"]);
  });

  it("supports legacy tool field on end event", async () => {
    const stream = makeStream([
      '{"type":"tool_execution_end","tool":"write","args":{"path":"/old.md"}}',
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.filesWritten).toEqual(["/old.md"]);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAnalyzerStream - error collection
// ---------------------------------------------------------------------------

describe("parseAnalyzerStream - error collection", () => {
  it("collects error when isError=true (real Pi format)", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/a.md" }),
      endEvent("call-1", "write", true),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("write");
  });

  it("collects multiple errors across events", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/a.md" }),
      endEvent("call-1", "write", true),
      startEvent("call-2", "read", { path: "/b.md" }),
      endEvent("call-2", "read", true),
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toHaveLength(2);
  });

  it("does not collect error when isError=false", async () => {
    const stream = makeStream([
      startEvent("call-1", "write", { path: "/ok.md" }),
      endEvent("call-1", "write", false),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toEqual([]);
  });

  it("collects string error from legacy error field", async () => {
    const stream = makeStream([
      '{"type":"tool_execution_end","tool":"write","error":"Permission denied"}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toEqual(["Permission denied"]);
  });

  it("collects error from legacy is_error=true field", async () => {
    const stream = makeStream([
      '{"type":"tool_execution_end","tool":"read","is_error":true}',
    ]);
    const result = await parseAnalyzerStream(stream);
    expect(result.errors).toHaveLength(1);
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
      '{"type":"agent_end"}',
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

    const stream = makeStream(["", "   ", '{"type":"agent_end"}', ""]);
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
      startEvent("r-1", "read", { path: "/obs.jsonl" }),
      endEvent("r-1", "read"),
      startEvent("w-1", "write", { path: "/inst/new-pattern.md" }),
      endEvent("w-1", "write"),
      startEvent("w-2", "write", { path: "/inst/old-pattern.md" }),
      endEvent("w-2", "write", true),
      '{"type":"agent_end"}',
    ]);
    const result = await parseAnalyzerStream(stream);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(["/inst/new-pattern.md"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("write");
  });
});
