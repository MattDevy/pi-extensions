import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import {
  getModel,
  getProviders,
  type Api,
  type KnownProvider,
  type Model,
} from "@mariozechner/pi-ai";
import type { Config } from "../types.js";

type AnalyzerAuthStorage = Pick<AuthStorage, "getApiKey">;

export interface AnalyzerModelResolution {
  readonly apiKey: string;
  readonly model: Model<Api>;
  readonly modelId: string;
  readonly providerId: string;
}

function isKnownProvider(value: string): value is KnownProvider {
  return (getProviders() as string[]).includes(value);
}

export async function resolveAnalyzerModel(
  config: Config,
  authStorage: AnalyzerAuthStorage,
): Promise<AnalyzerModelResolution> {
  const providerId = config.provider;
  const modelId = config.model;

  if (!isKnownProvider(providerId)) {
    throw new Error(`Unknown analyzer provider: ${providerId}`);
  }

  // getModel returns undefined for unknown model IDs but its overload signature
  // only accepts known model IDs — cast the result to include undefined so the
  // runtime guard below is reachable for arbitrary config values.
  const model = getModel(providerId, modelId as never) as Model<Api> | undefined;

  if (!model) {
    throw new Error(`Unknown analyzer model: ${providerId}/${modelId}`);
  }

  const apiKey = await authStorage.getApiKey(providerId);
  if (!apiKey) {
    throw new Error(
      `No API key configured for provider: ${providerId}. ` +
        "Set credentials via Pi auth.json, /login, or the provider's API key environment variable.",
    );
  }

  return { apiKey, model, modelId, providerId };
}
