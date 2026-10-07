import "server-only";
import { createDeepSeekProvider } from "./deepseek-provider";
import { AIGatewayError } from "./errors";
import { createGeminiProvider } from "./gemini-provider";
import { createOpenAIProvider } from "./openai-provider";
import { createOllamaProvider } from "./ollama-provider";
import type { AIProvider, ProviderId, ProviderStatus } from "./types";

// Defaults live here only. Deployments can override every model via server env.
const defaultModels: Record<ProviderId, string> = {
  openai: "gpt-5-mini",
  deepseek: "deepseek-flash",
  gemini: "gemini-3.8-flash",
  ollama: "qwen3:8b",
};

const defaultOllamaBaseUrl = "http://127.0.0.1:11434";
const providerIds: ProviderId[] = ["openai", "deepseek", "gemini", "ollama"];

function getOllamaBaseUrl(): string | undefined {
  const value = process.env.OLLAMA_BASE_URL?.trim() || defaultOllamaBaseUrl;
  try {
    const url = new URL(value);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function getProviderConfig(id: ProviderId) {
  const env: Record<ProviderId, { key?: string; model?: string }> = {
    openai: { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    deepseek: { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL },
    gemini: { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL },
    ollama: { model: process.env.OLLAMA_MODEL },
  };
  return {
    key: env[id].key?.trim() ?? "",
    model: env[id].model?.trim() || defaultModels[id],
  };
}

export function getProviderStatuses(): ProviderStatus[] {
  return providerIds.map((id) => {
    const { key, model } = getProviderConfig(id);
    return {
      id,
      configured: id === "ollama" ? !!getOllamaBaseUrl() : !!key,
      model,
    };
  });
}

export function getProvider(id: ProviderId): AIProvider {
  const { key, model } = getProviderConfig(id);
  if (id === "ollama") {
    const baseUrl = getOllamaBaseUrl();
    if (!baseUrl) throw new AIGatewayError("PROVIDER_NOT_CONFIGURED");
    return createOllamaProvider(baseUrl, model);
  }
  if (!key) throw new AIGatewayError("PROVIDER_NOT_CONFIGURED");
  switch (id) {
    case "openai": return createOpenAIProvider(key, model);
    case "deepseek": return createDeepSeekProvider(key, model);
    case "gemini": return createGeminiProvider(key, model);
  }
}
