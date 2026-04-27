import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import type { Config } from "../types.js";
import { resolveAnalyzerModel } from "./analyze-model.js";

function config(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe("resolveAnalyzerModel", () => {
  it("uses the configured provider and model", async () => {
    const authStorage = {
      getApiKey: vi.fn().mockResolvedValue("codex-token"),
    };

    const result = await resolveAnalyzerModel(
      config({ provider: "openai-codex", model: "gpt-5.4-mini" }),
      authStorage,
    );

    expect(result.providerId).toBe("openai-codex");
    expect(result.modelId).toBe("gpt-5.4-mini");
    expect(result.model.provider).toBe("openai-codex");
    expect(result.model.id).toBe("gpt-5.4-mini");
    expect(result.apiKey).toBe("codex-token");
    expect(authStorage.getApiKey).toHaveBeenCalledWith("openai-codex");
  });

  it("keeps Anthropic Haiku as the backwards-compatible default", async () => {
    const authStorage = {
      getApiKey: vi.fn().mockResolvedValue("anthropic-token"),
    };

    const result = await resolveAnalyzerModel(config(), authStorage);

    expect(result.providerId).toBe("anthropic");
    expect(result.modelId).toBe("claude-haiku-4-5");
    expect(result.model.provider).toBe("anthropic");
    expect(authStorage.getApiKey).toHaveBeenCalledWith("anthropic");
  });

  it("throws a provider-specific error when credentials are missing", async () => {
    const authStorage = {
      getApiKey: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      resolveAnalyzerModel(
        config({ provider: "openai-codex", model: "gpt-5.4-mini" }),
        authStorage,
      ),
    ).rejects.toThrow("No API key configured for provider: openai-codex");
  });

  it("throws a provider/model-specific error for unknown model ids", async () => {
    const authStorage = {
      getApiKey: vi.fn().mockResolvedValue("token"),
    };

    await expect(
      resolveAnalyzerModel(
        config({ provider: "openai-codex", model: "not-a-real-model" }),
        authStorage,
      ),
    ).rejects.toThrow("Unknown analyzer model: openai-codex/not-a-real-model");
    expect(authStorage.getApiKey).not.toHaveBeenCalled();
  });

  it("throws a provider-specific error for unknown provider strings", async () => {
    const authStorage = {
      getApiKey: vi.fn().mockResolvedValue("token"),
    };

    await expect(
      resolveAnalyzerModel(
        config({ provider: "not-a-real-provider", model: "claude-haiku-4-5" }),
        authStorage,
      ),
    ).rejects.toThrow("Unknown analyzer provider: not-a-real-provider");
    expect(authStorage.getApiKey).not.toHaveBeenCalled();
  });
});
