import { describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";
import { reserveCloudAiQuota } from "../quota";

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

// This fake checks the Gateway/RPC contract. Real PostgreSQL concurrency is a separate manual acceptance gate.
function fakeDailyUsage() {
  const counts = new Map<string, number>();
  let utcDate = "2026-10-08";
  const clientFor = (user: string): SupabaseClient => ({
    rpc: vi.fn(async (name: string) => {
      expect(name).toBe("reserve_cloud_ai_quota");
      const key = `${user}:${utcDate}`;
      const used = counts.get(key) ?? 0;
      if (used >= 30) {
        return { data: [{ allowed: false, remaining_count: 0, usage_date: utcDate }], error: null };
      }
      counts.set(key, used + 1);
      return { data: [{ allowed: true, remaining_count: 29 - used, usage_date: utcDate }], error: null };
    }),
  }) as unknown as SupabaseClient;
  return { counts, clientFor, setUtcDate: (date: string) => { utcDate = date; } };
}

describe("cloud quota RPC contract with a deterministic fake", () => {
  it("passes cancellation to the authenticated quota RPC", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn().mockResolvedValue({ data: [{ allowed: true, remaining_count: 29 }], error: null });
    const client = { rpc: vi.fn().mockReturnValue({ abortSignal }) } as unknown as SupabaseClient;
    expect(await reserveCloudAiQuota(client, signal)).toEqual({ remainingCount: 29 });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
  it("reserves the first use and reports 29 remaining", async () => {
    const { counts, clientFor } = fakeDailyUsage();
    expect(await reserveCloudAiQuota(clientFor("A"))).toEqual({ remainingCount: 29 });
    expect(counts.get("A:2026-10-08")).toBe(1);
  });

  it("allows the 30th use when one remains, then rejects the 31st", async () => {
    const { counts, clientFor } = fakeDailyUsage();
    const client = clientFor("A");
    counts.set("A:2026-10-08", 29);
    expect(await reserveCloudAiQuota(client)).toEqual({ remainingCount: 0 });
    await expect(reserveCloudAiQuota(client)).rejects.toMatchObject({ code: "CLOUD_QUOTA_EXCEEDED", status: 429 });
    expect(counts.get("A:2026-10-08")).toBe(30);
  });

  it("starts a new allowance on a new UTC date", async () => {
    const { counts, clientFor, setUtcDate } = fakeDailyUsage();
    const client = clientFor("A");
    counts.set("A:2026-10-08", 30);
    setUtcDate("2026-10-09");
    expect(await reserveCloudAiQuota(client)).toEqual({ remainingCount: 29 });
    expect(counts.get("A:2026-10-08")).toBe(30);
    expect(counts.get("A:2026-10-09")).toBe(1);
  });

  it("keeps users A and B separate", async () => {
    const { counts, clientFor } = fakeDailyUsage();
    counts.set("A:2026-10-08", 30);
    await expect(reserveCloudAiQuota(clientFor("A"))).rejects.toMatchObject({ code: "CLOUD_QUOTA_EXCEEDED" });
    expect(await reserveCloudAiQuota(clientFor("B"))).toEqual({ remainingCount: 29 });
    expect(counts.get("B:2026-10-08")).toBe(1);
  });

  it("never permits more than 30 calls through a concurrent fake RPC contract", async () => {
    const { counts, clientFor } = fakeDailyUsage();
    const client = clientFor("A");
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => reserveCloudAiQuota(client)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(30);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(20);
    expect(counts.get("A:2026-10-08")).toBe(30);
  });

  it("fails closed on RPC error, network failure or malformed response", async () => {
    const badResults = [
      { data: null, error: { message: "fake private database detail" } },
      { data: [], error: null },
      { data: [{ allowed: true, remaining_count: -1 }], error: null },
      { data: [{ allowed: true, remaining_count: 30 }], error: null },
      { data: [{ allowed: false, remaining_count: 1 }], error: null },
    ];
    for (const result of badResults) {
      const client = { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient;
      await expect(reserveCloudAiQuota(client)).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE", status: 503 });
    }
    const client = { rpc: vi.fn().mockRejectedValue(new Error("fake private database detail")) } as unknown as SupabaseClient;
    await expect(reserveCloudAiQuota(client)).rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE", status: 503 });
  });
});
