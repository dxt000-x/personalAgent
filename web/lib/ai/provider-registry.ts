import "server-only";
import { createDeepSeekProvider } from "./deepseek-provider";
import { AIGatewayError } from "./errors";
import { createGeminiProvider } from "./gemini-provider";
import { createOpenAIProvider } from "./openai-provider";
import { createOllamaProvider } from "./ollama-provider";
import type { AIProvider, ProviderId, ProviderStatus } from "./types";
import { OLLAMA_HEALTH_TIMEOUT_MS } from "./limits";

// Defaults live here only. Deployments can override every model via server env.
const defaultModels: Record<ProviderId, string> = {
  openai: "gpt-5-mini",
  deepseek: "deepseek-flash",
  gemini: "gemini-3.8-flash",
  ollama: "qwen3:8b",
};

const defaultOllamaBaseUrl = "http://127.0.0.1:11434";
const providerIds: ProviderId[] = ["openai", "deepseek", "gemini", "ollama"];
const providerTypes = { openai: "cloud", deepseek: "cloud", gemini: "cloud", ollama: "local" } as const;

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

async function isOllamaAvailable(baseUrl: string | undefined, model: string): Promise<boolean> {
  if (!baseUrl) return false;
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { models?: unknown }).models)) {
      return false;
    }
    return (payload as { models: unknown[] }).models.some((entry) =>
      typeof entry === "object" && entry !== null && "name" in entry && entry.name === model,
    );
  } catch {
    return false;
  }
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const ollamaBaseUrl = getOllamaBaseUrl();
  const statuses: ProviderStatus[] = providerIds.map((id) => {
    const { key, model } = getProviderConfig(id);
    const configured = id === "ollama" ? !!ollamaBaseUrl : !!key;
    return {
      id,
      type: providerTypes[id],
      configured,
      availability: id === "ollama" ? "unavailable" : configured ? "unknown" : "unavailable",
      model,
    };
  });
  const ollamaModel = statuses.find(({ id }) => id === "ollama")?.model;
  const ollamaAvailable = ollamaModel ? await isOllamaAvailable(ollamaBaseUrl, ollamaModel) : false;
  return statuses.map((status) => status.id === "ollama"
    ? { ...status, availability: ollamaAvailable ? "available" : "unavailable" }
    : status);
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
