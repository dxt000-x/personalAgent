export type ProviderId = "openai" | "deepseek" | "gemini" | "ollama" | "openrouter";
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
  knowledge?: { status: "used" | "no_match"; sources: import("@/lib/knowledge/search-types").KnowledgeSearchResult[] };
};

export type ProviderStatus = {
  id: ProviderId;
  type: ProviderType;
  configured: boolean;
  availability: ProviderAvailability;
  model: string;
};

export type ProviderLifecycleStage = "awaiting_headers" | "reading_body" | "response_complete";
export type ProviderLifecycleEvent =
  | { event: "request_started"; elapsedMs: number }
  | { event: "response_headers"; elapsedMs: number; status: number; upstreamRequestId?: string;
      openrouterGenerationId?: string;
      contentType?: string; contentLength?: string | number; transferEncoding?: string;
      upstreamRequestIdStatus?: "present" | "missing" | "invalid";
      openrouterGenerationIdStatus?: "present" | "missing" | "invalid" }
  | { event: "response_complete"; elapsedMs: number }
  | { event: "request_aborted" | "request_failed"; elapsedMs: number; stage: ProviderLifecycleStage };

export interface AIProvider {
  generate(messages: ChatMessage[], signal: AbortSignal, systemInstruction?: string,
    options?: { disableThinking?: boolean; onLifecycleEvent?: (event: ProviderLifecycleEvent) => void }): Promise<AIChatResult>;
}
