import { describe, expect, it, vi } from "vitest";
import { retrievePersonalMemoryContext } from "./context";
import type { createClient } from "@/lib/supabase/server";

describe("optional Memory retrieval timeout", () => {
  it("fails soft after an abort even if a database transport never settles", async () => {
    const abortSignal = vi.fn().mockReturnValue(new Promise(() => {}));
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>;
    const controller = new AbortController();
    const pending = retrievePersonalMemoryContext(client, "fake-user", [{ role: "user", content: "hello" }], controller.signal);
    controller.abort();
    const result = await pending;
    expect(result).toEqual({ metadata: { status: "unavailable", used: false, count: 0 }, diagnostic: "timeout" });
    expect(abortSignal).toHaveBeenCalledTimes(1);
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
  });

  it.each([
    [() => Promise.resolve({ data: null, error: { message: "fake private SQL error" } }), "database"],
    [() => Promise.reject(new Error("fake private network error")), "network"],
  ] as const)("returns a safe failure category for %s", async (queryResult, kind) => {
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.abortSignal.mockImplementation(queryResult);
    const client = { from: vi.fn().mockReturnValue(chain) } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>;
    const result = await retrievePersonalMemoryContext(client, "fake-user", [{ role: "user", content: "fake private message" }]);
    expect(result).toEqual({ metadata: { status: "unavailable", used: false, count: 0 }, diagnostic: kind });
    expect(JSON.stringify(result)).not.toContain("fake private");
  });
});
