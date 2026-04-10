import { describe, it, expect } from "vitest";
import { detectLanguage, getLanguageChecklist, isCodeFile } from "./language-detector.js";

describe("detectLanguage", () => {
  it("detects TypeScript files", () => {
    expect(detectLanguage("src/foo.ts")).toBe("typescript");
    expect(detectLanguage("src/bar.tsx")).toBe("typescript");
  });

  it("detects JavaScript files as typescript", () => {
    expect(detectLanguage("src/foo.js")).toBe("typescript");
    expect(detectLanguage("src/bar.jsx")).toBe("typescript");
  });

  it("detects Python files", () => {
    expect(detectLanguage("src/app.py")).toBe("python");
  });

  it("detects Go files", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("detects Rust files", () => {
    expect(detectLanguage("src/lib.rs")).toBe("rust");
  });

  it("detects Java files", () => {
    expect(detectLanguage("App.java")).toBe("java");
  });

  it("detects PHP files", () => {
    expect(detectLanguage("index.php")).toBe("php");
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguage("style.css")).toBeNull();
    expect(detectLanguage("data.json")).toBeNull();
    expect(detectLanguage("README.md")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(detectLanguage("App.TS")).toBe("typescript");
    expect(detectLanguage("Main.PY")).toBe("python");
  });
});

describe("getLanguageChecklist", () => {
  it("returns checklist for typescript", () => {
    const checklist = getLanguageChecklist("typescript");
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.some((item) => item.toLowerCase().includes("type"))).toBe(true);
  });

  it("returns checklist for python", () => {
    const checklist = getLanguageChecklist("python");
    expect(checklist.length).toBeGreaterThan(0);
  });

  it("returns checklist for go", () => {
    const checklist = getLanguageChecklist("go");
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist.some((item) => item.toLowerCase().includes("error"))).toBe(true);
  });

  it("returns empty array for unknown language", () => {
    expect(getLanguageChecklist("brainfuck")).toEqual([]);
  });
});

describe("isCodeFile", () => {
  it("returns true for code files", () => {
    expect(isCodeFile("src/foo.ts")).toBe(true);
    expect(isCodeFile("main.py")).toBe(true);
    expect(isCodeFile("lib.rs")).toBe(true);
  });

  it("returns false for config files", () => {
    expect(isCodeFile("package.json")).toBe(false);
    expect(isCodeFile("tsconfig.json")).toBe(false);
    expect(isCodeFile("Dockerfile")).toBe(false);
    expect(isCodeFile(".eslintrc.js")).toBe(false);
  });

  it("returns false for non-code extensions", () => {
    expect(isCodeFile("style.css")).toBe(false);
    expect(isCodeFile("README.md")).toBe(false);
    expect(isCodeFile("image.png")).toBe(false);
    expect(isCodeFile("package-lock.json")).toBe(false);
  });
});
