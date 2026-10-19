import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../openrouter-provider";
import { AIRequestDiagnostics, classifyOutgoingStream } from "../diagnostics";
import { AIRequestDeadline } from "../request-deadline";
import type { ProviderLifecycleEvent } from "../types";
import { parseAgentPlanText } from "@/lib/agent/planning";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("OpenRouter lifecycle with the installed SDK and an offline fetch", () => {
  it.each([
    { body: { choices: [{ finish_reason: "length", message: { content: null } }] },
      kind: "null", empty: undefined, finish: "length", failure: "missing_content" },
    { body: { choices: [{ finish_reason: "stop", message: {} }] },
      kind: "missing", empty: undefined, finish: "stop", failure: "missing_content" },
    { body: { choices: [{ finish_reason: "stop", message: { content: "" } }] },
      kind: "string", empty: true, finish: "stop", failure: "empty_content" },
    { body: { choices: [{ finish_reason: "length", message: { content: null,
      reasoning: "private reasoning", tool_calls: [{ command: "private command" }] } }] },
      kind: "null", empty: undefined, finish: "length", failure: "missing_content" },
    { body: { choices: [{ finish_reason: "content_filter", message: { content: null,
      refusal: "private refusal" } }] },
      kind: "null", empty: undefined, finish: "content_filter", failure: "missing_content" },
  ])("logs only response shape for $kind content and keeps $failure", async ({ body, kind, empty, finish, failure }) => {
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) }))
      .rejects.toMatchObject({ failure, code: "PROVIDER_ERROR", status: 502 });
    const events = diagnostics.snapshot("PROVIDER_ERROR").providerLifecycle;
    expect(events?.[3]).toMatchObject({ event: "response_structure", choicesStatus: "array", choiceCount: 1,
      firstChoicePresent: true, messagePresent: true, contentKind: kind, finishReason: finish,
      ...(empty === undefined ? {} : { contentEmpty: empty }) });
    expect(JSON.stringify(events)).not.toMatch(/private|command|prompt|reasoning/);
  });

  it("keeps nonempty truncated Plan JSON on the parser failure path", async () => {
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: '{"version":1,"steps":[' } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) });
    expect(parseAgentPlanText(result.text)).toBeNull();
    expect(diagnostics.snapshot("PROVIDER_ERROR").providerLifecycle?.[3]).toMatchObject({
      event: "response_structure", contentKind: "string", contentEmpty: false, finishReason: "length",
    });
    expect(JSON.stringify(diagnostics.snapshot("PROVIDER_ERROR"))).not.toContain(result.text);
  });

  it.each([
    { body: {}, status: "missing", count: 0 },
    { body: { choices: [] }, status: "array", count: 0 },
    { body: { choices: "private choices" }, status: "other", count: 0 },
    { body: { choices: Array.from({ length: 33 }, () => null) }, status: "array", count: "over_limit" },
  ])("bounds $status choices diagnostics", async ({ body, status, count }) => {
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) }))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
    expect(diagnostics.snapshot("PROVIDER_ERROR").providerLifecycle?.[3]).toMatchObject({
      event: "response_structure", choicesStatus: status, choiceCount: count,
      firstChoicePresent: false, messagePresent: false, contentKind: "missing",
    });
    expect(JSON.stringify(diagnostics.snapshot("PROVIDER_ERROR"))).not.toContain("private choices");
  });

  it("reduces malicious response fields and forged lifecycle values to fixed categories", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    diagnostics.recordProviderLifecycle({ event: "response_structure", elapsedMs: 1,
      choicesStatus: "private" as "array", choiceCount: 999, firstChoicePresent: true, messagePresent: true,
      contentKind: "private" as "string", contentEmpty: true, contentLength: 999999,
      finishReason: "private credential" as "stop", hasToolCalls: true, hasRefusal: false, hasReasoning: true });
    const record = diagnostics.snapshot("PROVIDER_ERROR").providerLifecycle?.[0];
    expect(record).toMatchObject({ choicesStatus: "other", choiceCount: "over_limit", contentKind: "other",
      finishReason: "other", hasToolCalls: true, hasReasoning: true });
    diagnostics.finish("PROVIDER_ERROR");
    diagnostics.finish("PROVIDER_ERROR");
    expect(log).toHaveBeenCalledTimes(1);
    const serialized = log.mock.calls[0][0] as string;
    expect(serialized).not.toMatch(/private|credential|prompt|command/);
    expect(JSON.parse(serialized).providerLifecycle[0]).toMatchObject({
      event: "response_structure", choicesStatus: "other", contentKind: "other", finishReason: "other",
    });
  });
  it("records allowlisted 429 headers without reading the error body twice", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = new Response(JSON.stringify({ error: { type: "rate_limit", code: "capacity_exceeded",
      message: "private upstream details" } }), { status: 429, headers: {
      "content-type": "application/json", "retry-after": "12", "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "0", "x-ratelimit-reset": "123456",
      "x-ratelimit-private": "private credential" } });
    const bodyRead = vi.spyOn(response, "text");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) })).rejects.toMatchObject({ status: 429 });
    diagnostics.finish("RATE_LIMITED");
    expect(bodyRead).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(logged.providerLifecycle[1]).toMatchObject({ status: 429, retryAfterSeconds: 12,
      rateLimitLimit: 100, rateLimitRemaining: 0, rateLimitReset: 123456 });
    expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key|capacity_exceeded|x-ratelimit-private/);
  });

  it("drops malformed or oversized rate-limit header values", () => {
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.recordProviderLifecycle({ event: "response_headers", elapsedMs: 1, status: 429,
      retryAfter: "private token", rateLimitLimit: "999999999999999999999",
      rateLimitRemaining: "secret", rateLimitReset: "invalid" });
    const record = JSON.stringify(diagnostics.snapshot("RATE_LIMITED"));
    expect(record).not.toMatch(/private|secret|999999999999999999999/);
    expect(diagnostics.snapshot("RATE_LIMITED").providerLifecycle?.[0]).toMatchObject({ status: 429 });
  });

  it("reports the installed SDK's serialized stream:false without exposing other request fields", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(classifyOutgoingStream(init?.body)).toBe("false");
      return new Response(JSON.stringify({ model: "local", choices: [{ message: { content: "private response" } }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }));
    await createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) });
    diagnostics.finish("SUCCESS");
    diagnostics.finish("SUCCESS");
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(logged.providerLifecycle[0]).toMatchObject({ event: "request_started", outgoingStreamStatus: "false" });
    expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key|local-placeholder/);
  });

  it.each([
    { body: undefined, status: "missing" },
    { body: JSON.stringify({ model: "local" }), status: "missing" },
    { body: JSON.stringify({ stream: true }), status: "true" },
    { body: JSON.stringify({ stream: "false" }), status: "invalid" },
    { body: "{invalid", status: "invalid" },
  ])("classifies serialized stream value as $status", ({ body, status }) => {
    expect(classifyOutgoingStream(body)).toBe(status);
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.recordProviderLifecycle({ event: "request_started", elapsedMs: 0,
      outgoingStreamStatus: status as "true" | "false" | "missing" | "invalid" });
    expect(diagnostics.snapshot("SUCCESS").providerLifecycle?.[0]).toMatchObject({ outgoingStreamStatus: status });
  });

  it.each([
    { generationId: "gen-1792312245-7umsx4QDpralWf1oIGE", status: "present",
      loggedId: "gen-1792312245-7umsx4QDpralWf1oIGE" },
    { generationId: null, status: "missing", loggedId: undefined },
    { generationId: "private generation id / token", status: "invalid", loggedId: undefined },
  ])("safely carries a $status Generation ID from response headers to the final log",
    async ({ generationId, status, loggedId }) => {
      vi.stubEnv("NODE_ENV", "development");
      const log = vi.spyOn(console, "info").mockImplementation(() => {});
      const headers = new Headers({ "content-type": "application/json" });
      if (generationId !== null) headers.set("x-generation-id", generationId);
      const response = new Response(JSON.stringify({ model: "fake-model",
        choices: [{ message: { content: "private response" } }] }), { status: 200, headers });
      const bodyRead = vi.spyOn(response, "json");
      vi.stubGlobal("fetch", vi.fn(async () => response));
      const diagnostics = new AIRequestDiagnostics("plan");
      diagnostics.attempt("openrouter");
      await createOpenRouterProvider("fake-key", "fake-model")
        .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
          { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) });
      diagnostics.finish("SUCCESS");
      diagnostics.finish("SUCCESS");
      expect(log).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(log.mock.calls[0][0] as string);
      expect(logged.requestId).toBe(diagnostics.requestId);
      expect(logged.providerLifecycle[1]).toMatchObject({ event: "response_headers", status: 200,
        upstreamRequestIdStatus: "missing", openrouterGenerationIdStatus: status });
      expect(logged.providerLifecycle[1].openrouterGenerationId).toBe(loggedId);
      expect(logged.providerLifecycle[1].upstreamRequestId).toBeUndefined();
      expect(bodyRead).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key/);
    });

  it("logs only allowlisted response header values without consuming the SDK body", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = new Response(JSON.stringify({ model: "fake-model",
      choices: [{ message: { content: "private response" } }] }), { status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "content-length": "81",
        "transfer-encoding": "chunked", "x-request-id": "safe-id" } });
    const bodyRead = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    await createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) });
    diagnostics.finish("SUCCESS");
    const record = JSON.parse(log.mock.calls[0][0] as string);
    expect(record.providerLifecycle[1]).toMatchObject({ contentType: "application/json",
      contentLength: 81, transferEncoding: "chunked", upstreamRequestId: "safe-id" });
    expect(bodyRead).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key|charset/);
  });

  it("reduces malformed response headers to fixed categories", () => {
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.recordProviderLifecycle({ event: "response_headers", elapsedMs: 1, status: 200,
      contentType: "private/content", contentLength: "private length", transferEncoding: "private encoding" });
    expect(diagnostics.snapshot("SUCCESS").providerLifecycle?.[0]).toMatchObject({
      contentType: "other", contentLength: "invalid", transferEncoding: "other",
      upstreamRequestIdStatus: "missing" });
    expect(JSON.stringify(diagnostics.snapshot("SUCCESS"))).not.toContain("private");
  });

  it.each([
    { header: "safe_req-123", status: "present", loggedId: "safe_req-123" },
    { header: null, status: "missing", loggedId: undefined },
    { header: "private credential with spaces", status: "invalid", loggedId: undefined },
  ])("safely carries a $status upstream ID from fetch headers into one final log", async ({ header, status, loggedId }) => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const headers = new Headers({ "content-type": "application/json" });
    if (header !== null) headers.set("x-request-id", header);
    const response = new Response(JSON.stringify({ model: "fake-model",
      choices: [{ message: { content: "private response" } }] }), { status: 200, headers });
    const bodyRead = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    await createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private prompt" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => diagnostics.recordProviderLifecycle(event) });
    diagnostics.finish("SUCCESS");
    diagnostics.finish("SUCCESS");
    expect(bodyRead).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(logged.requestId).toBe(diagnostics.requestId);
    expect(logged.providerLifecycle[1]).toMatchObject({ event: "response_headers", status: 200,
      upstreamRequestIdStatus: status });
    expect(logged.providerLifecycle[1].upstreamRequestId).toBe(loggedId);
    expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key/);
  });

  it("observes response headers before the SDK finishes reading the body", async () => {
    const events: ProviderLifecycleEvent[] = [];
    let bodyUsedAtHeaders: boolean | undefined;
    let finishBody!: () => void;
    const bodyGate = new Promise<void>((resolve) => { finishBody = resolve; });
    const upstreamResponse = new Response(new ReadableStream({
      async start(controller) {
        await bodyGate;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: "fake-model",
          choices: [{ message: { content: "complete" } }] })));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "sdk-safe-id" } });
    const bodyRead = vi.spyOn(upstreamResponse, "json");
    const fetchMock = vi.fn(async () => upstreamResponse);
    vi.stubGlobal("fetch", fetchMock);
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([{ role: "user", content: "private task" }], new AbortController().signal, undefined,
        { onLifecycleEvent: (event) => {
          if (event.event === "response_headers") bodyUsedAtHeaders = upstreamResponse.bodyUsed;
          events.push(event);
        } });
    try {
      await vi.waitFor(() => expect(events.map(({ event }) => event)).toEqual(["request_started", "response_headers"]));
      expect(events[1]).toMatchObject({ status: 200, upstreamRequestId: "sdk-safe-id" });
      expect(bodyUsedAtHeaders).toBe(false);
      expect(upstreamResponse.bodyUsed).toBe(true);
      expect(bodyRead).toHaveBeenCalledTimes(1);
    } finally { finishBody(); }
    await expect(pending).resolves.toMatchObject({ text: "complete" });
    expect(events.at(-2)).toMatchObject({ event: "response_complete" });
    expect(events.at(-1)).toMatchObject({ event: "response_structure", contentKind: "string" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyRead).toHaveBeenCalledTimes(1);
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

  it("cancels a stalled body read at the 25-second attempt signal without waiting in real time", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const events: ProviderLifecycleEvent[] = [];
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const attemptController = new AbortController();
    let attemptTimer!: ReturnType<typeof setTimeout>;
    const attempt = deadline.attemptSignals(25_000, (milliseconds) => {
      attemptTimer = setTimeout(() => attemptController.abort(), milliseconds);
      return attemptController.signal;
    });
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const fetchMock = vi.fn(async (_input: unknown, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => bodyController.error(new Error("private body abort")), { once: true });
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { bodyController = stream; } }),
        { status: 200, headers: { "content-type": "application/json", "x-generation-id": "gen-timeout123" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], attempt.signal, undefined, { onLifecycleEvent: (event) => {
        events.push(event);
        diagnostics.recordProviderLifecycle(event);
      } });
    const outcome = pending.then(() => "unexpected_success", (error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(events.map(({ event }) => event)).toEqual(["request_started", "response_headers"]);
      await vi.advanceTimersByTimeAsync(24_999);
      expect(await outcome).toBeInstanceOf(Error);
      expect(attempt.abortOrigin()).toBe("provider_attempt_timeout");
      expect(events).toMatchObject([{ event: "request_started" }, { event: "response_headers", status: 200 },
        { event: "request_aborted", stage: "reading_body" },
        { event: "request_failed", stage: "reading_body" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(events)).not.toContain("private");
      diagnostics.finish("TIMEOUT");
      diagnostics.finish("TIMEOUT");
      expect(log).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(log.mock.calls[0][0] as string);
      expect(logged.requestId).toBe(diagnostics.requestId);
      expect(logged.finalErrorCode).toBe("TIMEOUT");
      expect(logged.providerLifecycle[1]).toMatchObject({ event: "response_headers", status: 200,
        openrouterGenerationIdStatus: "present", openrouterGenerationId: "gen-timeout123" });
      expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key/);
    } finally {
      clearTimeout(attemptTimer);
      attempt.close();
      deadline.close();
      vi.useRealTimers();
    }
  });

  it("cancels after a partial body without independently reading its bytes", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: ProviderLifecycleEvent[] = [];
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => bodyController.error(new Error("private abort")), { once: true });
      return new Response(new ReadableStream<Uint8Array>({ start(stream) {
        bodyController = stream;
        stream.enqueue(new TextEncoder().encode('{"choices":'));
      } }), { status: 200, headers: { "content-type": "application/json", "transfer-encoding": "chunked" } });
    }));
    const timer = setTimeout(() => controller.abort(), 25_000);
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], controller.signal, undefined, { onLifecycleEvent: (event) => events.push(event) });
    const outcome = pending.then(() => "unexpected_success", (error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(25_000);
      expect(await outcome).toBeInstanceOf(Error);
      expect(events).toMatchObject([{ event: "request_started" }, { event: "response_headers", status: 200 },
        { event: "request_aborted", stage: "reading_body" },
        { event: "request_failed", stage: "reading_body" }]);
      expect(JSON.stringify(events)).not.toContain("private");
    } finally { clearTimeout(timer); vi.useRealTimers(); }
  });

  it("reports a body stream error without falsely reporting a request abort", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = new AIRequestDiagnostics("plan");
    diagnostics.attempt("openrouter");
    const events: ProviderLifecycleEvent[] = [];
    let failBody!: () => void;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"choices":'));
        failBody = () => stream.error(new Error("private stream failure"));
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const pending = createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => {
        events.push(event);
        diagnostics.recordProviderLifecycle(event);
      } });
    await vi.waitFor(() => expect(events.map(({ event }) => event)).toEqual(["request_started", "response_headers"]));
    failBody();
    await expect(pending).rejects.toBeDefined();
    expect(events.map(({ event }) => event)).toEqual(["request_started", "response_headers", "request_failed"]);
    expect(events.at(-1)).toMatchObject({ stage: "reading_body" });
    diagnostics.finish("PROVIDER_ERROR");
    diagnostics.finish("PROVIDER_ERROR");
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(logged.requestId).toBe(diagnostics.requestId);
    expect(logged.providerLifecycle.at(-1)).toMatchObject({ event: "request_failed", stage: "reading_body" });
    expect(log.mock.calls[0][0]).not.toMatch(/private|fake-key/);
  });

  it("keeps malformed completed JSON in the SDK parse error path", async () => {
    const events: ProviderLifecycleEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"choices":', { status: 200,
      headers: { "content-type": "application/json", "content-length": "11" } })));
    await expect(createOpenRouterProvider("fake-key", "fake-model")
      .generate([], new AbortController().signal, undefined, { onLifecycleEvent: (event) => events.push(event) }))
      .rejects.toBeInstanceOf(SyntaxError);
    expect(events).toMatchObject([{ event: "request_started" }, { event: "response_headers", status: 200 },
      { event: "request_failed", stage: "reading_body" }]);
  });
});
