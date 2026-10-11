import "server-only";
import OpenAI from "openai";
import { AIGatewayError } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "./limits";
import type { AIProvider } from "./types";

const groqBaseUrl = "https://api.groq.com/openai/v1";

export function createGroqProvider(apiKey: string, model: string): AIProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: groqBaseUrl,
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
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          ...(model === "openai/gpt-oss-20b" ? { reasoning_effort: "low" as const } : {}),
          stream: false,
        },
        { signal },
      );
      const text = response.choices[0]?.message.content?.trim();
      if (!text) throw new AIGatewayError("PROVIDER_ERROR");
      return {
        text: text.slice(0, MAX_OUTPUT_CHARACTERS),
        provider: "groq",
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
