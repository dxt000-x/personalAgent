import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { createOpenRouterProvider } from "../openrouter-provider";
import { MAX_OUTPUT_TOKENS, PROVIDER_TIMEOUT_MS } from "../limits";
import { ProviderResponseError } from "../errors";
import type { ProviderLifecycleEvent } from "../types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), config: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  return { default: class {
    static APIError = actual.default.APIError;
    chat = { completions: { create: mocks.create } };
    constructor(options: unknown) { mocks.config(options); }
  } };
});

function response(body: unknown, status = 200, requestId = "safe-id_123") {
  return new Response(JSON.stringify(body), { status, headers: { "x-request-id": requestId,
    "content-type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockSdk() {
  mocks.create.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
    const config = mocks.config.mock.lastCall?.[0] as { fetch: typeof fetch };
    const result = await config.fetch("https://openrouter.ai/api/v1/chat/completions", { signal: options.signal });
    if (!result.ok) throw new OpenAI.APIError(result.status, {}, "private upstream body", result.headers);
    return result.json();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ choices: [{ message: { content: "complete" } }] })));
  mockSdk();
});
afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter provider with an offline SDK mock", () => {
  it("keeps the SDK timeout after the Gateway attempt limit", async () => {
    await createOpenRouterProvider("fake-key", "fake-model").generate([], new AbortController().signal);
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({
      timeout: PROVIDER_TIMEOUT_MS + 1_000, maxRetries: 0,
      fetch: expect.any(Function),
    }));
  });

  it("rejects an empty completed response as an internal provider error", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ choices: [{ message: { content: "" } }] }));
    await expect(createOpenRouterProvider("fake-key", "fake-model").generate([], new AbortController().signal))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it.each([
    { body: { choices: [] }, failure: "empty_choices" },
    { body: { choices: [{}] }, failure: "missing_content" },
    { body: { choices: [{ message: { content: null } }] }, failure: "missing_content" },
    { body: { choices: [{ message: { content: "   " } }] }, failure: "empty_content" },
    { body: { choices: [{ message: { content: 42 } }] }, failure: "malformed_response" },
    { body: {}, failure: "malformed_response" },
  ])("classifies $failure without exposing response content", async ({ body, failure }) => {
    vi.mocked(fetch).mockResolvedValue(response(body));
    const result = createOpenRouterProvider("fake-key", "fake-model").generate([], new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(ProviderResponseError);
    await expect(result).rejects.toMatchObject({ failure, code: "PROVIDER_ERROR", status: 502 });
  });

  it("requests a complete non-streaming response and forwards the attempt signal", async () => {
    const controller = new AbortController();
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private task" }], controller.signal, "planning rules");
    await pending;
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "fake-model", stream: false, max_tokens: MAX_OUTPUT_TOKENS,
    }), { signal: controller.signal });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("records start, response headers and completed body in the final event sequence", async () => {
    const events: ProviderLifecycleEvent[] = [];
    vi.mocked(fetch).mockResolvedValue(response({ model: "fake-model", choices: [{ message: { content: "private output" } }] }));
    const result = await createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private task" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => events.push(event) });
    expect(result.text).toBe("private output");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "response_headers", status: 200, upstreamRequestId: "safe-id_123" },
      { event: "response_complete" }]);
    expect(JSON.stringify(events)).not.toMatch(/private|credential/);
  });

  it("records failure before headers when fetch never receives a response", async () => {
    const events: ProviderLifecycleEvent[] = [];
    vi.mocked(fetch).mockRejectedValue(new Error("private connection detail"));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => events.push(event) }))
      .rejects.toThrow("private connection detail");
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "request_failed", stage: "awaiting_headers" }]);
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("records headers before a body read timeout", async () => {
    const events: ProviderLifecycleEvent[] = [];
    const body = deferred<unknown>();
    mocks.create.mockImplementation(async (_request: unknown, options: { signal: AbortSignal }) => {
      const config = mocks.config.mock.lastCall?.[0] as { fetch: typeof fetch };
      await config.fetch("https://openrouter.ai/api/v1/chat/completions", { signal: options.signal });
      return body.promise;
    });
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => events.push(event) });
    await vi.waitFor(() => expect(events).toHaveLength(2));
    body.reject(new Error("private body timeout"));
    await expect(pending).rejects.toThrow("private body timeout");
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "response_headers", status: 200 }, { event: "request_failed", stage: "reading_body" }]);
  });

  it("records upstream HTTP status even when the SDK rejects its response", async () => {
    const events: ProviderLifecycleEvent[] = [];
    vi.mocked(fetch).mockResolvedValue(response({ error: "private error" }, 503, "upstream_503"));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => events.push(event) }))
      .rejects.toMatchObject({ status: 503 });
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "response_headers", status: 503, upstreamRequestId: "upstream_503" },
      { event: "request_failed", stage: "reading_body" }]);
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("records the cancellation stage without replacing the attempt signal", async () => {
    const events: ProviderLifecycleEvent[] = [];
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("private abort detail")), { once: true });
    }));
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], controller.signal, undefined, { onLifecycleEvent: (event) => events.push(event) });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("private abort detail");
    expect(events).toMatchObject([{ event: "request_started" },
      { event: "request_aborted", stage: "awaiting_headers" },
      { event: "request_failed", stage: "awaiting_headers" }]);
  });
});
