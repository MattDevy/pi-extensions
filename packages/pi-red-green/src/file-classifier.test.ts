import { describe, it, expect } from "vitest";
import { classifyFile, detectLanguage } from "./file-classifier.js";
import { DEFAULT_CONFIG } from "./config.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("src/auth.ts")).toBe("typescript");
    expect(detectLanguage("App.tsx")).toBe("typescript");
  });

  it("detects JavaScript as typescript", () => {
    expect(detectLanguage("index.js")).toBe("typescript");
    expect(detectLanguage("App.jsx")).toBe("typescript");
  });

  it("detects Python", () => {
    expect(detectLanguage("main.py")).toBe("python");
  });

  it("detects Go", () => {
    expect(detectLanguage("handler.go")).toBe("go");
  });

  it("detects Rust", () => {
    expect(detectLanguage("lib.rs")).toBe("rust");
  });

  it("detects Java", () => {
    expect(detectLanguage("UserService.java")).toBe("java");
  });

  it("detects PHP", () => {
    expect(detectLanguage("Controller.php")).toBe("php");
  });

  it("returns null for unknown extensions", () => {
    expect(detectLanguage("data.csv")).toBeNull();
    expect(detectLanguage("README.md")).toBeNull();
  });
});

describe("classifyFile", () => {
  const config = DEFAULT_CONFIG;

  describe("TypeScript test files", () => {
    it("classifies .test.ts as test", () => {
      expect(classifyFile("src/auth.test.ts", config)).toBe("test");
    });

    it("classifies .spec.ts as test", () => {
      expect(classifyFile("src/auth.spec.ts", config)).toBe("test");
    });

    it("classifies .test.tsx as test", () => {
      expect(classifyFile("components/Button.test.tsx", config)).toBe("test");
    });

    it("classifies nested test files", () => {
      expect(classifyFile("packages/core/src/utils.test.ts", config)).toBe("test");
    });
  });

  describe("Python test files", () => {
    it("classifies test_ prefix as test", () => {
      expect(classifyFile("tests/test_auth.py", config)).toBe("test");
    });

    it("classifies _test suffix as test", () => {
      expect(classifyFile("tests/auth_test.py", config)).toBe("test");
    });
  });

  describe("Go test files", () => {
    it("classifies _test.go as test", () => {
      expect(classifyFile("handler_test.go", config)).toBe("test");
    });
  });

  describe("Rust test files", () => {
    it("classifies files under tests/ as test", () => {
      expect(classifyFile("src/tests/integration.rs", config)).toBe("test");
    });
  });

  describe("Java test files", () => {
    it("classifies *Test.java as test", () => {
      expect(classifyFile("src/test/UserServiceTest.java", config)).toBe("test");
    });

    it("classifies *Spec.java as test", () => {
      expect(classifyFile("src/test/UserServiceSpec.java", config)).toBe("test");
    });
  });

  describe("Implementation files", () => {
    it("classifies regular .ts as implementation", () => {
      expect(classifyFile("src/auth.ts", config)).toBe("implementation");
    });

    it("classifies regular .py as implementation", () => {
      expect(classifyFile("src/auth.py", config)).toBe("implementation");
    });

    it("classifies regular .go as implementation", () => {
      expect(classifyFile("cmd/server.go", config)).toBe("implementation");
    });
  });

  describe("Other files", () => {
    it("classifies JSON as other", () => {
      expect(classifyFile("package.json", config)).toBe("other");
    });

    it("classifies markdown as other", () => {
      expect(classifyFile("README.md", config)).toBe("other");
    });

    it("classifies CSS as other", () => {
      expect(classifyFile("styles.css", config)).toBe("other");
    });

    it("classifies config files as other", () => {
      expect(classifyFile("tsconfig.json", config)).toBe("other");
      expect(classifyFile("vitest.config.ts", config)).toBe("other");
      expect(classifyFile("eslint.config.js", config)).toBe("other");
      expect(classifyFile("Makefile", config)).toBe("other");
      expect(classifyFile("Dockerfile", config)).toBe("other");
    });

    it("classifies lock files as other", () => {
      expect(classifyFile("package-lock.json", config)).toBe("other");
    });

    it("classifies dotfiles as other", () => {
      expect(classifyFile(".gitignore", config)).toBe("other");
      expect(classifyFile(".env", config)).toBe("other");
    });
  });

  describe("Windows paths", () => {
    it("normalizes backslashes", () => {
      expect(classifyFile("src\\auth.test.ts", config)).toBe("test");
      expect(classifyFile("src\\auth.ts", config)).toBe("implementation");
    });
  });
});
