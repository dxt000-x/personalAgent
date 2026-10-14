import { describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";
import { retrievePersonalMemoryContext } from "./context";
import { rankMemories, type RankableMemory } from "./rank";

const candidateCount = 200;
const contentLength = 1_990;
const fixedNow = Date.parse("2026-10-14T12:00:00Z");
const query = "请结合 TypeScript 和中文项目经验回答";
const mixedContent = "中文知识 TypeScript project 记忆 context ".repeat(80).slice(0, contentLength);

function candidates(): RankableMemory[] {
  return Array.from({ length: candidateCount }, (_, index) => ({
    id: `memory-${String(index).padStart(3, "0")}`,
    content: mixedContent,
    category: index % 2 === 0 ? "work" : "study",
    importance: (index % 5 + 1) as RankableMemory["importance"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  }));
}

describe("Memory maximum-candidate offline performance boundary", () => {
  it("ranks 200 near-limit mixed-language records within the local 2-second budget", () => {
    const rows = candidates();
    expect(rows).toHaveLength(200);
    expect(rows.every(({ content }) => content.length === contentLength)).toBe(true);
    rankMemories(rows, query, fixedNow); // Warm up the pure function before measuring.

    const samples = Array.from({ length: 10 }, () => {
      const started = performance.now();
      const ranked = rankMemories(rows, query, fixedNow);
      expect(ranked).toHaveLength(candidateCount);
      return performance.now() - started;
    }).sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(`[memory-performance] candidates=${candidateCount} content_chars=${contentLength} rank_p95_ms=${p95.toFixed(2)}`);
    expect(p95).toBeLessThan(2_000);
  });

  it("generates bounded context from the same 200 records without any real database", async () => {
    const rows = candidates();
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.abortSignal.mockResolvedValue({ data: rows, error: null });
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>;

    const started = performance.now();
    const result = await retrievePersonalMemoryContext(client, "synthetic-user", [{ role: "user", content: query }]);
    const elapsed = performance.now() - started;
    console.info(`[memory-performance] candidates=${candidateCount} context_mock_ms=${elapsed.toFixed(2)} injected=${result.metadata.count} output_chars=${result.systemInstruction?.length ?? 0}`);

    expect(chain.eq).toHaveBeenCalledWith("user_id", "synthetic-user");
    expect(chain.limit).toHaveBeenCalledWith(candidateCount);
    expect(result.metadata.used).toBe(true);
    expect(result.metadata.count).toBeGreaterThan(0);
    expect(result.metadata.count).toBeLessThanOrEqual(8);
    expect(result.systemInstruction?.length).toBeLessThanOrEqual(4_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});
