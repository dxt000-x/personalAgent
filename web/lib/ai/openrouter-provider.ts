import "server-only";
import OpenAI from "openai";
import { AIGatewayError } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "./limits";
import type { AIProvider } from "./types";

const openRouterBaseUrl = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider(apiKey: string, model: string): AIProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: openRouterBaseUrl,
    maxRetries: 0,
    timeout: PROVIDER_TIMEOUT_MS,
  });

  return {
    async generate(messages, signal, systemInstruction) {
      const response = await client.chat.completions.create(
        {
          model,
          messages: [
            ...(systemInstruction ? [{ role: "system" as const, content: systemInstruction }] : []),
            ...messages.map(({ role, content }) => ({ role, content })),
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: false,
        },
        { signal },
      );
      const text = response.choices[0]?.message.content?.trim();
      if (!text) throw new AIGatewayError("PROVIDER_ERROR");
      return {
        text: text.slice(0, MAX_OUTPUT_CHARACTERS),
        provider: "openrouter",
        model: response.model || model,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}
