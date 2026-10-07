import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AIGatewayError } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS } from "./limits";
import type { AIProvider } from "./types";

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    async generate(messages, signal) {
      const response = await client.models.generateContent({
        model,
        contents: messages.map(({ role, content }) => ({
          role: role === "assistant" ? "model" : "user",
          parts: [{ text: content }],
        })),
        config: { maxOutputTokens: MAX_OUTPUT_TOKENS, abortSignal: signal },
      });
      const text = response.text?.trim();
      if (!text) throw new AIGatewayError("PROVIDER_ERROR");
      const usage = response.usageMetadata;
      return {
        text: text.slice(0, MAX_OUTPUT_CHARACTERS),
        provider: "gemini",
        model: response.modelVersion || model,
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount,
              outputTokens: usage.candidatesTokenCount,
              totalTokens: usage.totalTokenCount,
            }
          : undefined,
      };
    },
  };
}
