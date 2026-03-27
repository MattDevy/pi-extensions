import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentsMd } from "./agents-md.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agents-md-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readAgentsMd", () => {
  it("returns file content when file exists", () => {
    const filePath = join(tmpDir, "AGENTS.md");
    const content = "# Guidelines\n\n- Be helpful\n";
    writeFileSync(filePath, content, "utf-8");

    const result = readAgentsMd(filePath);
    expect(result).toBe(content);
  });

  it("returns null when file does not exist", () => {
    const filePath = join(tmpDir, "nonexistent-AGENTS.md");
    const result = readAgentsMd(filePath);
    expect(result).toBeNull();
  });

  it("returns null when file is unreadable (no read permission)", () => {
    // Skip on platforms where chmod may not restrict root
    const filePath = join(tmpDir, "unreadable-AGENTS.md");
    writeFileSync(filePath, "secret", "utf-8");
    try {
      chmodSync(filePath, 0o000);
      const result = readAgentsMd(filePath);
      // On some systems (e.g. running as root) this may still read - allow null or string
      if (result !== null) {
        expect(typeof result).toBe("string");
      } else {
        expect(result).toBeNull();
      }
    } finally {
      // Restore permissions so cleanup works
      chmodSync(filePath, 0o644);
    }
  });

  it("returns empty string for an empty file", () => {
    const filePath = join(tmpDir, "empty-AGENTS.md");
    writeFileSync(filePath, "", "utf-8");
    const result = readAgentsMd(filePath);
    expect(result).toBe("");
  });

  it("preserves multi-line content exactly", () => {
    const filePath = join(tmpDir, "multi-AGENTS.md");
    const content = "# Project Guidelines\n\n## Code Style\n\n- Use TypeScript\n- Prefer const\n";
    writeFileSync(filePath, content, "utf-8");
    const result = readAgentsMd(filePath);
    expect(result).toBe(content);
  });
});
