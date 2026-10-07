export type ProviderId = "openai" | "deepseek" | "gemini" | "ollama";
export type ProviderSelection = ProviderId | "auto";
export type RoutingPreference = "auto" | "privacy";
export type ProviderType = "cloud" | "local";
export type ProviderAvailability = "unknown" | "available" | "unavailable";
export type RoutingReason =
  | "local_provider_available"
  | "cloud_provider_fallback"
  | "cloud_provider_selected"
  | "privacy_local_only"
  | "fallback_after_provider_error";

export type MemoryContextStatus = "used" | "none" | "unavailable" | "omitted";

export type MemoryUsage = {
  status: MemoryContextStatus;
  used: boolean;
  count: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AIUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AIChatResult = {
  text: string;
  provider: ProviderId;
  model: string;
  usage?: AIUsage;
  memory?: MemoryUsage;
  routing?: {
    mode: "auto";
    reason: RoutingReason;
  };
};

export type ProviderStatus = {
  id: ProviderId;
  type: ProviderType;
  configured: boolean;
  availability: ProviderAvailability;
  model: string;
};

export interface AIProvider {
  generate(messages: ChatMessage[], signal: AbortSignal, systemInstruction?: string): Promise<AIChatResult>;
}
