import { describe, it, expect } from "vitest";
import { scrubSecrets, REDACTED } from "./scrubber.js";

describe("scrubSecrets", () => {
  describe("authorization headers", () => {
    it("scrubs Authorization: Bearer header", () => {
      const input =
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });

    it("scrubs Authorization: Basic header", () => {
      const input = "Authorization: Basic dXNlcjpwYXNzd29yZA==";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });

    it("scrubs Authorization: token header", () => {
      const input = "Authorization: token ghp_abcdef1234567890";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });

    it("scrubs bearer token standalone (case insensitive)", () => {
      const input = "Bearer sk-abc123xyzDEF456uvwGHI789jklMNO012";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });
  });

  describe("HTTP header shorthand", () => {
    it("scrubs x-api-key header", () => {
      const input = "x-api-key: abcdef123456";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });

    it("scrubs x-auth-token header", () => {
      const input = "x-auth-token: some-auth-token-value";
      expect(scrubSecrets(input)).toBe(REDACTED);
    });
  });

  describe("API key assignments", () => {
    it("scrubs api_key= assignment", () => {
      const result = scrubSecrets("api_key=supersecretvalue");
      expect(result).toBe(REDACTED);
    });

    it("scrubs apiKey: assignment", () => {
      const result = scrubSecrets("apiKey: supersecretvalue");
      expect(result).toBe(REDACTED);
    });

    it("scrubs api-key= assignment", () => {
      const result = scrubSecrets("api-key=supersecretvalue");
      expect(result).toBe(REDACTED);
    });

    it("scrubs access_key= assignment", () => {
      const result = scrubSecrets("access_key=MYACCESSKEYVALUE");
      expect(result).toBe(REDACTED);
    });

    it("scrubs secret_key= assignment", () => {
      const result = scrubSecrets("secret_key=topsecretvalue");
      expect(result).toBe(REDACTED);
    });
  });

  describe("token assignments", () => {
    it("scrubs access_token= assignment", () => {
      const result = scrubSecrets("access_token=abc123def456");
      expect(result).toBe(REDACTED);
    });

    it("scrubs auth_token: assignment", () => {
      const result = scrubSecrets("auth_token: mytoken123");
      expect(result).toBe(REDACTED);
    });

    it("scrubs refresh_token= assignment", () => {
      const result = scrubSecrets("refresh_token=refreshvalue99");
      expect(result).toBe(REDACTED);
    });
  });

  describe("password fields", () => {
    it("scrubs password= assignment", () => {
      const result = scrubSecrets("password=hunter2");
      expect(result).toBe(REDACTED);
    });

    it("scrubs passwd: assignment", () => {
      const result = scrubSecrets("passwd: topsecret");
      expect(result).toBe(REDACTED);
    });

    it("scrubs pwd= assignment", () => {
      const result = scrubSecrets("pwd=mysecretpwd");
      expect(result).toBe(REDACTED);
    });
  });

  describe("secret / credential fields", () => {
    it("scrubs secret= assignment", () => {
      const result = scrubSecrets("secret=mysecretvalue");
      expect(result).toBe(REDACTED);
    });

    it("scrubs credential= assignment", () => {
      const result = scrubSecrets("credential=mycredvalue");
      expect(result).toBe(REDACTED);
    });

    it("scrubs private_key= assignment", () => {
      const result = scrubSecrets("private_key=-----BEGINRSAPRIVATEKEY");
      expect(result).toBe(REDACTED);
    });
  });

  describe("AWS keys", () => {
    it("scrubs AWS Access Key ID", () => {
      const result = scrubSecrets("AKIAIOSFODNN7EXAMPLE");
      expect(result).toBe(REDACTED);
    });

    it("scrubs AWS key embedded in JSON", () => {
      const input =
        '{"access_key_id": "AKIAIOSFODNN7EXAMPLE", "region": "us-east-1"}';
      const result = scrubSecrets(input);
      expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result).toContain(REDACTED);
      // region is preserved
      expect(result).toContain("us-east-1");
    });
  });

  describe("OpenAI / Anthropic keys", () => {
    it("scrubs OpenAI API key (sk- prefix)", () => {
      const result = scrubSecrets(
        "sk-abcdefghijklmnopqrstuvwxyz01234567890ABCDEFGHIJKLM",
      );
      expect(result).toBe(REDACTED);
    });

    it("scrubs Anthropic API key (sk-ant-api03- prefix)", () => {
      const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz01234567890ABCDEF";
      const result = scrubSecrets(key);
      expect(result).toBe(REDACTED);
    });
  });

  describe("multi-secret text", () => {
    it("scrubs multiple secrets in one string", () => {
      const input = "password=hunter2 api_key=someapikey123";
      const result = scrubSecrets(input);
      expect(result).not.toContain("hunter2");
      expect(result).not.toContain("someapikey123");
      expect(result).toContain(REDACTED);
    });

    it("preserves surrounding non-secret text", () => {
      const input =
        "Calling endpoint https://api.example.com with api_key=secret123 and retries=3";
      const result = scrubSecrets(input);
      expect(result).toContain("https://api.example.com");
      expect(result).toContain("retries=3");
      expect(result).not.toContain("secret123");
    });
  });

  describe("no false positives on normal code", () => {
    it("does not modify plain function names", () => {
      const code =
        "function calculateTotal(items) { return items.reduce((a, b) => a + b, 0); }";
      expect(scrubSecrets(code)).toBe(code);
    });

    it("does not modify variable assignments with safe names", () => {
      const code = "const count = 42; const name = 'Alice';";
      expect(scrubSecrets(code)).toBe(code);
    });

    it("does not modify URLs without secrets", () => {
      const url = "https://api.example.com/v1/users?page=1&limit=10";
      expect(scrubSecrets(url)).toBe(url);
    });

    it("does not modify git log output", () => {
      const log =
        "commit abc123def456\nAuthor: Alice <alice@example.com>\nDate: Mon Mar 25 2026";
      expect(scrubSecrets(log)).toBe(log);
    });

    it("does not modify normal JSON without secrets", () => {
      const json = '{"name": "Alice", "age": 30, "active": true}';
      expect(scrubSecrets(json)).toBe(json);
    });
  });
});
