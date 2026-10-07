export type ProviderId = "openai" | "deepseek" | "gemini";

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
};

export type ProviderStatus = {
  id: ProviderId;
  configured: boolean;
  model: string;
};

export interface AIProvider {
  generate(messages: ChatMessage[], signal: AbortSignal): Promise<AIChatResult>;
}
