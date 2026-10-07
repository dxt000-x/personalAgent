import "server-only";
import { createDeepSeekProvider } from "./deepseek-provider";
import { AIGatewayError } from "./errors";
import { createGeminiProvider } from "./gemini-provider";
import { createOpenAIProvider } from "./openai-provider";
import type { AIProvider, ProviderId, ProviderStatus } from "./types";

// Defaults live here only. Deployments can override every model via server env.
const defaultModels: Record<ProviderId, string> = {
  openai: "gpt-5-mini",
  deepseek: "deepseek-flash",
  gemini: "gemini-3.8-flash",
};

const providerIds: ProviderId[] = ["openai", "deepseek", "gemini"];

function getProviderConfig(id: ProviderId) {
  const env: Record<ProviderId, { key?: string; model?: string }> = {
    openai: { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    deepseek: { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL },
    gemini: { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
  };
  return {
    key: env[id].key?.trim() ?? "",
    model: env[id].model?.trim() || defaultModels[id],
  };
}

export function getProviderStatuses(): ProviderStatus[] {
  return providerIds.map((id) => {
    const { key, model } = getProviderConfig(id);
    return { id, configured: !!key, model };
  });
}

export function getProvider(id: ProviderId): AIProvider {
  const { key, model } = getProviderConfig(id);
  if (!key) throw new AIGatewayError("PROVIDER_NOT_CONFIGURED");
  switch (id) {
    case "openai": return createOpenAIProvider(key, model);
    case "deepseek": return createDeepSeekProvider(key, model);
    case "gemini": return createGeminiProvider(key, model);
  }
}
