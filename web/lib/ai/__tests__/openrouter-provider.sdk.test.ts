import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../openrouter-provider";
import type { ProviderLifecycleEvent } from "../types";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter lifecycle with the installed SDK and an offline fetch", () => {
  it("observes response headers before the SDK finishes reading the body", async () => {
    const events: ProviderLifecycleEvent[] = [];
    let finishBody!: () => void;
    const bodyGate = new Promise<void>((resolve) => { finishBody = resolve; });
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      async start(controller) {
        await bodyGate;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: "fake-model",
          choices: [{ message: { content: "complete" } }] })));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "sdk-safe-id" } }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private task" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => events.push(event) });
    try {
      await vi.waitFor(() => expect(events.map(({ event }) => event)).toEqual(["request_started", "response_headers"]));
      expect(events[1]).toMatchObject({ status: 200, upstreamRequestId: "sdk-safe-id" });
    } finally { finishBody(); }
    await expect(pending).resolves.toMatchObject({ text: "complete" });
    expect(events.at(-1)).toMatchObject({ event: "response_complete" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("observes non-2xx headers before the SDK reads and rejects the error body", async () => {
    const events: ProviderLifecycleEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "private body" }),
      { status: 503, headers: { "content-type": "application/json", "x-request-id": "sdk-error-id" } })));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ status: 503 });
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "response_headers", status: 503, upstreamRequestId: "sdk-error-id" },
      { event: "request_failed", stage: "reading_body" }]);
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("propagates the caller's abort through the SDK to its fetch", async () => {
    const events: ProviderLifecycleEvent[] = [];
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("private abort detail")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], controller.signal, undefined, { onLifecycleEvent: (event) => events.push(event) });
    await vi.waitFor(() => expect(events[0]).toMatchObject({ event: "request_started" }));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "request_aborted", stage: "awaiting_headers" },
      { event: "request_failed", stage: "awaiting_headers" }]);
    expect(JSON.stringify(events)).not.toContain("private");
  });
});
