import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { AIGatewayError, providerFailure } from "./errors";
import { AUTO_PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from "./limits";
import { getProvider } from "./provider-registry";
import { reserveCloudAiQuota } from "./quota";
import { getAutoRoute } from "./router";
import type { AIChatResult, ChatMessage, ProviderId, ProviderSelection, RoutingPreference, RoutingReason } from "./types";

type AuthenticatedClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** Shared chat/extraction path: one quota reservation per routed request, before cloud I/O. */
export async function runAiGateway(
  supabase: AuthenticatedClient,
  input: { provider: ProviderSelection; routingPreference: RoutingPreference; messages: ChatMessage[]; systemInstruction?: string },
): Promise<AIChatResult> {
  let cloudQuotaReserved = false;
  async function generate(providerId: ProviderId, timeoutMs: number) {
    const provider = getProvider(providerId);
    // An unconfigured provider fails in the registry before consuming quota.
    if (providerId !== "ollama" && !cloudQuotaReserved) {
      await reserveCloudAiQuota(supabase);
      cloudQuotaReserved = true;
    }
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await provider.generate(input.messages, signal, input.systemInstruction);
    } catch (error) {
      throw error instanceof AIGatewayError ? error : providerFailure(error, signal);
    }
  }

  if (input.provider !== "auto") return generate(input.provider, PROVIDER_TIMEOUT_MS);

  const route = await getAutoRoute({ preference: input.routingPreference });
  let lastError: AIGatewayError | undefined;
  for (let index = 0; index < route.length; index += 1) {
    const candidate = route[index];
    try {
      const result = await generate(candidate.provider, AUTO_PROVIDER_TIMEOUT_MS);
      const reason: RoutingReason = index > 0 ? "fallback_after_provider_error" : candidate.reason;
      return { ...result, routing: { mode: "auto", reason } };
    } catch (error) {
      const safeError = error instanceof AIGatewayError ? error : new AIGatewayError("PROVIDER_ERROR");
      lastError = safeError;
      if (index >= route.length - 1 || !["PROVIDER_ERROR", "TIMEOUT"].includes(safeError.code)) throw safeError;
    }
  }
  throw lastError ?? new AIGatewayError("PROVIDER_ERROR");
}
