import "server-only";
import OpenAI from "openai";
import { ProviderResponseError } from "./errors";
import { MAX_OUTPUT_CHARACTERS, MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "./limits";
import type { AIProvider, ProviderLifecycleStage } from "./types";

const openRouterBaseUrl = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider(apiKey: string, model: string): AIProvider {
  return {
    async generate(messages, signal, systemInstruction, options) {
      const startedAt = performance.now();
      const elapsedMs = () => Math.round(performance.now() - startedAt);
      let stage: ProviderLifecycleStage = "awaiting_headers";
      const onAbort = () => options?.onLifecycleEvent?.({ event: "request_aborted", elapsedMs: elapsedMs(), stage });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        // A client per generate call keeps the observer isolated if the provider is used concurrently.
        const client = new OpenAI({
          apiKey,
          baseURL: openRouterBaseUrl,
          maxRetries: 0,
          // The Gateway's 25-second attempt signal is authoritative; keep the SDK timer as a later fallback.
          timeout: PROVIDER_TIMEOUT_MS + 1_000,
          fetch: async (input, init) => {
            options?.onLifecycleEvent?.({ event: "request_started", elapsedMs: elapsedMs() });
            const response = await globalThis.fetch(input, init);
            stage = "reading_body";
            options?.onLifecycleEvent?.({ event: "response_headers", elapsedMs: elapsedMs(), status: response.status,
              upstreamRequestId: response.headers.get("x-request-id") ?? undefined,
              openrouterGenerationId: response.headers.get("x-generation-id") ?? undefined,
              contentType: response.headers.get("content-type") ?? undefined,
              contentLength: response.headers.get("content-length") ?? undefined,
              transferEncoding: response.headers.get("transfer-encoding") ?? undefined });
            return response;
          },
        });
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
        stage = "response_complete";
        options?.onLifecycleEvent?.({ event: "response_complete", elapsedMs: elapsedMs() });
        if (!response || !Array.isArray(response.choices)) throw new ProviderResponseError("malformed_response");
        if (response.choices.length === 0) throw new ProviderResponseError("empty_choices");
        const content = response.choices[0]?.message?.content;
        if (content === null || content === undefined) throw new ProviderResponseError("missing_content");
        if (typeof content !== "string") throw new ProviderResponseError("malformed_response");
        const text = content.trim();
        if (!text) throw new ProviderResponseError("empty_content");
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
      } catch (error) {
        options?.onLifecycleEvent?.({ event: "request_failed", elapsedMs: elapsedMs(), stage });
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
