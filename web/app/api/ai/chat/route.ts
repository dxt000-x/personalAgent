import { AIGatewayError, providerFailure } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { AUTO_PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from "@/lib/ai/limits";
import { getProvider } from "@/lib/ai/provider-registry";
import { getAutoRoute } from "@/lib/ai/router";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import type { AIChatResult, ProviderId, RoutingReason } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new AIGatewayError("INVALID_REQUEST");
    }

    const { provider: providerId, routingPreference, messages } = validateChatRequest(await readJsonBody(request));

    // Add persistent per-user daily quota enforcement here before enabling paid cloud providers publicly.
    void userId;

    if (providerId !== "auto") {
      const result = await generate(providerId, messages, PROVIDER_TIMEOUT_MS);
      return aiJson(result);
    }

    const route = await getAutoRoute({ preference: routingPreference });
    let lastError: AIGatewayError | undefined;
    for (let index = 0; index < route.length; index += 1) {
      const candidate = route[index];
      try {
        const result = await generate(candidate.provider, messages, AUTO_PROVIDER_TIMEOUT_MS);
        const reason: RoutingReason = index > 0 ? "fallback_after_provider_error" : candidate.reason;
        return aiJson({
          ...result,
          routing: { mode: "auto", reason },
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

async function generate(providerId: ProviderId, messages: Parameters<ReturnType<typeof getProvider>["generate"]>[0], timeoutMs: number) {
  const provider = getProvider(providerId);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await provider.generate(messages, signal);
  } catch (error) {
    throw error instanceof AIGatewayError ? error : providerFailure(error, signal);
  }
}
