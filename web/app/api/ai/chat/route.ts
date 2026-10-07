import { AIGatewayError, providerFailure } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { AUTO_PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from "@/lib/ai/limits";
import { getProvider } from "@/lib/ai/provider-registry";
import { getAutoRoute } from "@/lib/ai/router";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import type { AIChatResult, ProviderId, RoutingReason } from "@/lib/ai/types";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase, userId } = await requireAuthenticatedUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new AIGatewayError("INVALID_REQUEST");
    }

    const { provider: providerId, routingPreference, messages } = validateChatRequest(await readJsonBody(request));
    const memoryContext = await retrievePersonalMemoryContext(supabase, userId, messages);

    if (providerId !== "auto") {
      const result = await generate(providerId, messages, PROVIDER_TIMEOUT_MS, memoryContext.systemInstruction);
      return aiJson({ ...result, memory: memoryContext.metadata } satisfies AIChatResult);
    }

    const route = await getAutoRoute({ preference: routingPreference });
    let lastError: AIGatewayError | undefined;
    for (let index = 0; index < route.length; index += 1) {
      const candidate = route[index];
      try {
        const result = await generate(candidate.provider, messages, AUTO_PROVIDER_TIMEOUT_MS, memoryContext.systemInstruction);
        const reason: RoutingReason = index > 0 ? "fallback_after_provider_error" : candidate.reason;
        return aiJson({
          ...result,
          routing: { mode: "auto", reason },
          memory: memoryContext.metadata,
        } satisfies AIChatResult);
      } catch (error) {
        const safeError = error instanceof AIGatewayError ? error : new AIGatewayError("PROVIDER_ERROR");
        lastError = safeError;
        if (index >= route.length - 1 || !["PROVIDER_ERROR", "TIMEOUT"].includes(safeError.code)) {
          throw safeError;
        }
      }
    }
    throw lastError ?? new AIGatewayError("PROVIDER_ERROR");
  } catch (error) {
    return aiErrorResponse(error);
  }
}

async function generate(
  providerId: ProviderId,
  messages: Parameters<ReturnType<typeof getProvider>["generate"]>[0],
  timeoutMs: number,
  systemInstruction?: string,
) {
  const provider = getProvider(providerId);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await provider.generate(messages, signal, systemInstruction);
  } catch (error) {
    throw error instanceof AIGatewayError ? error : providerFailure(error, signal);
  }
}
