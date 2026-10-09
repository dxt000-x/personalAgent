import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { AIGatewayError, providerFailure } from "./errors";
import { AUTO_PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from "./limits";
import { AIRequestDeadline, MIN_CLOUD_START_MS, MIN_FALLBACK_WINDOW_MS } from "./request-deadline";
import { AIRequestDiagnostics } from "./diagnostics";
import { getProvider } from "./provider-registry";
import { reserveCloudAiQuota } from "./quota";
import { getAutoRoute } from "./router";
import type { AIChatResult, ChatMessage, ProviderId, ProviderSelection, RoutingPreference, RoutingReason } from "./types";

type AuthenticatedClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** Shared chat/extraction path: one quota reservation per routed request, before cloud I/O. */
export async function runAiGateway(
  supabase: AuthenticatedClient,
  input: { provider: ProviderSelection; routingPreference: RoutingPreference; messages: ChatMessage[]; systemInstruction?: string; disableThinking?: boolean },
  deadline: AIRequestDeadline,
  diagnostics?: AIRequestDiagnostics,
): Promise<AIChatResult> {
  // Public routes already validate this combination; keep the shared boundary safe too.
  if (input.routingPreference === "privacy" && input.provider !== "auto" && input.provider !== "ollama") {
    throw new AIGatewayError("INVALID_REQUEST");
  }
  diagnostics?.setRouting(input.provider, input.routingPreference);
  let cloudQuotaReserved = false;
  async function generate(providerId: ProviderId, timeoutMs: number) {
    deadline.assertRemaining(providerId === "ollama" ? 1 : MIN_CLOUD_START_MS);
    const provider = getProvider(providerId);
    // An unconfigured provider fails in the registry before consuming quota.
    if (providerId !== "ollama" && !cloudQuotaReserved) {
      await (diagnostics
        ? diagnostics.measure("quotaDurationMs", () => reserveCloudAiQuota(supabase, deadline.signal))
        : reserveCloudAiQuota(supabase, deadline.signal));
      cloudQuotaReserved = true;
    }
    deadline.assertRemaining(providerId === "ollama" ? 1 : MIN_CLOUD_START_MS);
    const signal = deadline.attemptSignal(timeoutMs);
    diagnostics?.attempt(providerId);
    try {
      const result = await (diagnostics
        ? diagnostics.measure("providerDurationMs", () => provider.generate(input.messages, signal, input.systemInstruction, { disableThinking: input.disableThinking }))
        : provider.generate(input.messages, signal, input.systemInstruction, { disableThinking: input.disableThinking }));
      if (signal.aborted) throw new AIGatewayError("TIMEOUT");
      deadline.assertRemaining();
      return result;
    } catch (error) {
      throw error instanceof AIGatewayError ? error : providerFailure(error, signal);
    }
  }

  if (input.provider !== "auto") return generate(input.provider, PROVIDER_TIMEOUT_MS);

  deadline.assertRemaining();
  const route = await (diagnostics
    ? diagnostics.measure("routeDurationMs", () => getAutoRoute({ preference: input.routingPreference, signal: deadline.signal }))
    : getAutoRoute({ preference: input.routingPreference, signal: deadline.signal }));
  deadline.assertRemaining();
  let lastError: AIGatewayError | undefined;
  for (let index = 0; index < route.length; index += 1) {
    const candidate = route[index];
    try {
      const remaining = deadline.remainingMs();
      const firstAttemptBudget = index === 0 && route.length > 1
        ? Math.max(1, remaining - MIN_FALLBACK_WINDOW_MS)
        : remaining;
      const result = await generate(candidate.provider, Math.min(AUTO_PROVIDER_TIMEOUT_MS, firstAttemptBudget));
      const reason: RoutingReason = index > 0 ? "fallback_after_provider_error" : candidate.reason;
      return { ...result, routing: { mode: "auto", reason } };
    } catch (error) {
      const safeError = error instanceof AIGatewayError ? error : new AIGatewayError("PROVIDER_ERROR");
      lastError = safeError;
      if (index >= route.length - 1 || !["PROVIDER_ERROR", "TIMEOUT"].includes(safeError.code)) throw safeError;
      deadline.assertRemaining();
    }
  }
  throw lastError ?? new AIGatewayError("PROVIDER_ERROR");
}
