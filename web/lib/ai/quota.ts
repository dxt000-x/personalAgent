import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { AIGatewayError } from "./errors";

type AuthenticatedSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;
export type CloudQuotaReservation = { remainingCount: number };

/** The RPC derives the user and UTC date from its authenticated database context. */
export async function reserveCloudAiQuota(supabase: AuthenticatedSupabaseClient, signal?: AbortSignal): Promise<CloudQuotaReservation> {
  let result: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    const operation = supabase.rpc("reserve_cloud_ai_quota");
    result = await (signal ? operation.abortSignal(signal) : operation);
  } catch {
    if (signal?.aborted) throw new AIGatewayError("TIMEOUT");
    throw new AIGatewayError("QUOTA_UNAVAILABLE");
  }

  if (signal?.aborted) throw new AIGatewayError("TIMEOUT");
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new AIGatewayError("QUOTA_UNAVAILABLE");
  }
  const row: unknown = result.data[0];
  if (typeof row !== "object" || row === null) throw new AIGatewayError("QUOTA_UNAVAILABLE");
  const { allowed, remaining_count: remaining } = row as Record<string, unknown>;
  if (typeof allowed !== "boolean" || typeof remaining !== "number"
    || !Number.isInteger(remaining) || remaining < 0 || remaining > 29
    || (!allowed && remaining !== 0)) {
    throw new AIGatewayError("QUOTA_UNAVAILABLE");
  }
  if (!allowed) throw new AIGatewayError("CLOUD_QUOTA_EXCEEDED");
  return { remainingCount: remaining };
}
