import "server-only";
import OpenAI from "openai";
import { AIGatewayError } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "./limits";
import type { AIProvider } from "./types";

export function createOpenAIProvider(apiKey: string, model: string): AIProvider {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: PROVIDER_TIMEOUT_MS });

  return {
    async generate(messages, signal) {
      const response = await client.responses.create(
        {
          model,
          input: messages.map(({ role, content }) => ({ role, content })),
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
        },
        { signal },
      );
      const text = response.output_text?.trim();
      if (!text) throw new AIGatewayError("PROVIDER_ERROR");
      return {
        text: text.slice(0, MAX_OUTPUT_CHARACTERS),
        provider: "openai",
        model: response.model || model,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}
