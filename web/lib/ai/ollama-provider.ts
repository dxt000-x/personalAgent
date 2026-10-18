import "server-only";
import { AIGatewayError, upstreamHttpFailure } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS } from "./limits";
import type { AIProvider } from "./types";

type OllamaChatResponse = {
  model?: unknown;
  message?: { content?: unknown };
  prompt_eval_count?: unknown;
  eval_count?: unknown;
};

export function createOllamaProvider(baseUrl: string, model: string): AIProvider {
  return {
    async generate(messages, signal, systemInstruction, options) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
              ...messages,
            ],
            stream: false,
            ...(options?.disableThinking && model === "qwen3:8b" ? { think: false } : {}),
            options: { num_predict: MAX_OUTPUT_TOKENS },
          }),
          signal,
          cache: "no-store",
        });
      } catch {
        if (signal.aborted) throw new AIGatewayError("TIMEOUT");
        throw new AIGatewayError("PROVIDER_ERROR");
      }

      if (!response.ok) {
        throw upstreamHttpFailure(response.status, signal);
      }

      let result: OllamaChatResponse;
      try {
        result = await response.json() as OllamaChatResponse;
      } catch {
        if (signal.aborted) throw new AIGatewayError("TIMEOUT");
        throw new AIGatewayError("PROVIDER_ERROR");
      }

      if (signal.aborted) throw new AIGatewayError("TIMEOUT");

      const text = typeof result.message?.content === "string" ? result.message.content.trim() : "";
      if (!text) throw new AIGatewayError("PROVIDER_ERROR");

      const inputTokens = typeof result.prompt_eval_count === "number" ? result.prompt_eval_count : undefined;
      const outputTokens = typeof result.eval_count === "number" ? result.eval_count : undefined;
      const usage = inputTokens !== undefined || outputTokens !== undefined
        ? {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens !== undefined && outputTokens !== undefined
              ? inputTokens + outputTokens
              : undefined,
          }
        : undefined;

      return {
        text: text.slice(0, MAX_OUTPUT_CHARACTERS),
        provider: "ollama",
        model: typeof result.model === "string" && result.model ? result.model : model,
        usage,
      };
    },
  };
}
