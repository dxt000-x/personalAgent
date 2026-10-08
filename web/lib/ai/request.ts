import { AIGatewayError } from "./errors";
import {
  MAX_INPUT_CHARACTERS,
  MAX_MESSAGE_CHARACTERS,
  MAX_MESSAGES,
  MAX_REQUEST_BYTES,
} from "./limits";
import type { ChatMessage, ProviderId, ProviderSelection, RoutingPreference } from "./types";

export type ChatRequest = {
  provider: ProviderSelection;
  routingPreference: RoutingPreference;
  messages: ChatMessage[];
};

export async function readJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new AIGatewayError("INVALID_REQUEST");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new AIGatewayError("INVALID_REQUEST", 413);
  }

  if (!request.body) throw new AIGatewayError("INVALID_REQUEST");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AIGatewayError("INVALID_REQUEST", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof AIGatewayError) throw error;
    throw new AIGatewayError("INVALID_REQUEST");
  } finally {
    reader.releaseLock();
  }
}

export function validateChatRequest(value: unknown): ChatRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AIGatewayError("INVALID_REQUEST");
  }
  const input = value as Record<string, unknown>;
  if (!["auto", "openai", "deepseek", "gemini", "ollama", "openrouter"].includes(String(input.provider))) {
    throw new AIGatewayError("INVALID_REQUEST");
  }
  const routingPreference = input.routingPreference === undefined ? "auto" : input.routingPreference;
  if (routingPreference !== "auto" && routingPreference !== "privacy") throw new AIGatewayError("INVALID_REQUEST");
  if (routingPreference === "privacy" && input.provider !== "auto" && input.provider !== "ollama") {
    throw new AIGatewayError("INVALID_REQUEST");
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > MAX_MESSAGES) {
    throw new AIGatewayError("INVALID_REQUEST");
  }

  let totalCharacters = 0;
  const messages: ChatMessage[] = input.messages.map((message: unknown) => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    const entry = message as Record<string, unknown>;
    if (entry.role !== "user" && entry.role !== "assistant") {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    if (typeof entry.content !== "string" || !entry.content.trim() || entry.content.length > MAX_MESSAGE_CHARACTERS) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    totalCharacters += entry.content.length;
    if (totalCharacters > MAX_INPUT_CHARACTERS) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    return { role: entry.role, content: entry.content };
  });

  if (messages.at(-1)?.role !== "user") {
    throw new AIGatewayError("INVALID_REQUEST");
  }
  return { provider: input.provider as ProviderId | "auto", routingPreference, messages };
}
