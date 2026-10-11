import "server-only";
import { AIGatewayError } from "./errors";
import { getProviderStatuses } from "./provider-registry";
import type { ProviderId, ProviderStatus, RoutingPreference, RoutingReason } from "./types";

export type RouterInput = {
  preference: RoutingPreference;
  signal?: AbortSignal;
};

export type ProviderCandidate = Pick<ProviderStatus, "id" | "type" | "configured" | "availability" | "model">;

export type RouterDecision = {
  provider: ProviderId;
  model: string;
  reason: RoutingReason;
};

const cloudPriority: ProviderId[] = ["openrouter", "groq", "openai", "deepseek", "gemini"];
export const MAX_AUTO_PROVIDER_ATTEMPTS = 2;

function getStatus(statuses: ProviderStatus[], id: ProviderId) {
  return statuses.find((status) => status.id === id);
}

export async function getAutoRoute(input: RouterInput): Promise<RouterDecision[]> {
  const statuses = await getProviderStatuses(input.signal);
  const preference = input.preference;
  const local = getStatus(statuses, "ollama");

  if (preference === "privacy") {
    if (!local?.configured || local.availability !== "available") {
      throw new AIGatewayError("PRIVACY_PROVIDER_UNAVAILABLE");
    }
    return [{ provider: "ollama", model: local.model, reason: "privacy_local_only" }];
  }

  const availableLocal = local?.configured && local.availability === "available" ? local : undefined;
  const configuredCloud = cloudPriority
    .map((id) => getStatus(statuses, id))
    .filter((status): status is ProviderStatus => !!status?.configured && status.availability !== "unavailable");

  if (!availableLocal && !configuredCloud.length) {
    if (statuses.some((status) => status.configured)) throw new AIGatewayError("PROVIDER_ERROR");
    throw new AIGatewayError("PROVIDER_NOT_CONFIGURED");
  }

  const ordered = [
    ...(availableLocal ? [availableLocal] : []),
    ...configuredCloud,
  ].slice(0, MAX_AUTO_PROVIDER_ATTEMPTS);

  return ordered.map((status, index) => ({
    provider: status.id,
    model: status.model,
    reason: index > 0
      ? "fallback_after_provider_error"
      : availableLocal
        ? "local_provider_available"
        : local?.configured
          ? "cloud_provider_fallback"
          : "cloud_provider_selected",
  }));
}
