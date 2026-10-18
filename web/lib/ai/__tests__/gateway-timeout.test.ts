import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError as GeminiApiError } from "@google/genai";
import OpenAI from "openai";
import { runAiGateway } from "../gateway";
import { AIGatewayError, ProviderResponseError, UpstreamHttpError } from "../errors";
import { getProvider, getProviderStatuses } from "../provider-registry";
import { reserveCloudAiQuota } from "../quota";
import { AIRequestDeadline } from "../request-deadline";
import { AIRequestDiagnostics } from "../diagnostics";
import type { createClient } from "@/lib/supabase/server";
import type { AIProvider, ProviderId, ProviderStatus } from "../types";

vi.mock("../provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("../quota", () => ({ reserveCloudAiQuota: vi.fn() }));

const ids: ProviderId[] = ["ollama", "openrouter", "openai", "deepseek", "gemini"];
const calls = Object.fromEntries(ids.map((id) => [id, vi.fn<AIProvider["generate"]>()])) as Record<ProviderId, ReturnType<typeof vi.fn<AIProvider["generate"]>>>;
const client = {} as NonNullable<Awaited<ReturnType<typeof createClient>>>;
const messages = [{ role: "user" as const, content: "fake request" }];

function statuses(localAvailable = true): ProviderStatus[] {
  return ids.map((id) => ({ id, type: id === "ollama" ? "local" : "cloud", configured: true,
    availability: id === "ollama" ? localAvailable ? "available" : "unavailable" : "unknown", model: `fake-${id}` }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getProviderStatuses).mockResolvedValue(statuses());
  vi.mocked(reserveCloudAiQuota).mockResolvedValue({ remainingCount: 29 });
  for (const id of ids) calls[id].mockResolvedValue({ text: "fake response", provider: id, model: `fake-${id}` });
  vi.mocked(getProvider).mockImplementation((id) => ({ generate: calls[id] }));
});

describe("shared Gateway deadline behavior with fake providers", () => {
  it("records success without a failure origin", async () => {
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      await expect(runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline, diagnostics))
        .resolves.toMatchObject({ provider: "openrouter" });
      expect(diagnostics.snapshot("SUCCESS")).not.toHaveProperty("failureOrigin");
    } finally { deadline.close(); }
  });

  it.each([
    { error: new OpenAI.APIConnectionTimeoutError(), code: "TIMEOUT", status: 504, origin: "sdk_timeout", kind: "sdk_timeout" },
    { error: new OpenAI.APIError(408, {}, "private prompt", new Headers()), code: "TIMEOUT", status: 504, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new OpenAI.APIError(401, {}, "private prompt", new Headers()), code: "PROVIDER_AUTH_FAILED", status: 502, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new OpenAI.APIError(404, {}, "private prompt", new Headers()), code: "PROVIDER_REQUEST_REJECTED", status: 502, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new OpenAI.APIError(429, {}, "private prompt", new Headers()), code: "RATE_LIMITED", status: 429, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new OpenAI.APIError(503, {}, "private prompt", new Headers()), code: "PROVIDER_ERROR", status: 502, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new GeminiApiError({ status: 503, message: "private prompt" }), code: "PROVIDER_ERROR", status: 502, origin: "upstream_http", kind: "upstream_http_error" },
    { error: new OpenAI.APIConnectionError({ message: "private prompt" }), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "sdk_connection_error" },
    { error: new OpenAI.APIError(undefined, {}, "private prompt", new Headers()), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "sdk_api_error" },
    { error: new SyntaxError("private prompt"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "response_parse_error" },
    { error: new ProviderResponseError("empty_choices"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "empty_choices" },
    { error: new ProviderResponseError("missing_content"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "missing_content" },
    { error: new ProviderResponseError("empty_content"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "empty_content" },
    { error: new ProviderResponseError("malformed_response"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "malformed_response" },
    { error: new AIGatewayError("PROVIDER_ERROR"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "internal_gateway_error" },
    { error: new Error("private prompt"), code: "PROVIDER_ERROR", status: 502, origin: "unknown", kind: "unexpected_provider_error" },
  ])("classifies $kind without recording raw errors", async ({ error, code, status, origin, kind }) => {
    calls.openrouter.mockRejectedValue(error);
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      await expect(runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline, diagnostics))
        .rejects.toMatchObject({ code, status });
      const record = diagnostics.snapshot(code as "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED"
        | "PROVIDER_AUTH_FAILED" | "PROVIDER_REQUEST_REJECTED");
      expect(record).toMatchObject({ failureOrigin: origin, failureKind: kind,
        attemptNumber: 1, finalErrorCode: code });
      expect(JSON.stringify(record)).not.toContain("private prompt");
      expect(JSON.stringify(record)).not.toContain("sk-test-secret");
    } finally { deadline.close(); }
  });

  it("does not label an internal empty-response error as upstream HTTP", async () => {
    calls.openrouter.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      await expect(runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline, diagnostics))
        .rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
      expect(diagnostics.snapshot("PROVIDER_ERROR")).toMatchObject({ failureOrigin: "unknown",
        failureKind: "internal_gateway_error" });
    } finally { deadline.close(); }
  });

  it.each([
    { first: "client", origin: "client_abort" },
    { first: "attempt", origin: "provider_attempt_timeout" },
  ])("records the first real abort source: $first", async ({ first, origin }) => {
    const clientAbort = new AbortController();
    const attemptAbort = new AbortController();
    const deadline = new AIRequestDeadline(clientAbort.signal);
    const realAttemptSignals = deadline.attemptSignals.bind(deadline);
    vi.spyOn(deadline, "attemptSignals").mockImplementation((ms) => realAttemptSignals(ms, () => attemptAbort.signal));
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    calls.openrouter.mockImplementation((_messages, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError()), { once: true });
      started();
    }));
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      const pending = runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline, diagnostics);
      await providerStarted;
      if (first === "client") { clientAbort.abort(); attemptAbort.abort(); }
      else { attemptAbort.abort(); clientAbort.abort(); }
      await expect(pending).rejects.toMatchObject({ code: "TIMEOUT", status: 504 });
      expect(diagnostics.snapshot("TIMEOUT")).toMatchObject({ failureOrigin: origin, failureKind: origin });
    } finally { deadline.close(); }
  });

  it("uses unknown when an SDK timeout and attempt abort are both observed", async () => {
    const timeout = new AbortController();
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const realAttemptSignals = deadline.attemptSignals.bind(deadline);
    vi.spyOn(deadline, "attemptSignals").mockImplementation((ms) => realAttemptSignals(ms, () => timeout.signal));
    calls.openrouter.mockImplementation(async () => { timeout.abort(); throw new OpenAI.APIConnectionTimeoutError(); });
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      await expect(runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline, diagnostics))
        .rejects.toMatchObject({ code: "TIMEOUT" });
      expect(diagnostics.snapshot("TIMEOUT")).toMatchObject({ failureOrigin: "unknown",
        failureKind: "abort_race_unknown" });
    } finally { deadline.close(); }
  });

  it("recognizes a confirmed local HTTP response without trusting an internal status", async () => {
    calls.ollama.mockRejectedValue(new UpstreamHttpError("RATE_LIMITED"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      await expect(runAiGateway(client, { provider: "ollama", routingPreference: "auto", messages }, deadline, diagnostics))
        .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
      expect(diagnostics.snapshot("RATE_LIMITED")).toMatchObject({ failureOrigin: "upstream_http",
        failureKind: "upstream_http_error" });
    } finally { deadline.close(); }
  });
  it("times out explicit Ollama without reaching cloud", async () => {
    calls.ollama.mockImplementation((_messages, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("fake abort")), { once: true });
    }));
    const deadline = new AIRequestDeadline(new AbortController().signal, 30);
    try {
      await expect(runAiGateway(client, { provider: "ollama", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "TIMEOUT" });
      expect(calls.ollama).toHaveBeenCalledTimes(1);
      for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("times out explicit OpenRouter without fallback or a second reservation", async () => {
    calls.openrouter.mockRejectedValue(Object.assign(new Error("fake timeout with secret"), { name: "APIConnectionTimeoutError" }));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "openrouter", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "TIMEOUT" });
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      for (const id of ids.filter((id) => id !== "openrouter")) expect(calls[id]).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("keeps Privacy local-only when Ollama times out", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("TIMEOUT"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "auto", routingPreference: "privacy", messages,
        systemInstruction: "fake Memory context" }, deadline)).rejects.toMatchObject({ code: "TIMEOUT" });
      expect(calls.ollama).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).not.toHaveBeenCalled();
      for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("does not start cloud fallback when the first candidate consumed the remaining budget", async () => {
    let now = 0;
    const deadline = new AIRequestDeadline(new AbortController().signal, 5000, () => now);
    calls.ollama.mockImplementation(async () => { now = 4100; throw new AIGatewayError("TIMEOUT"); });
    try {
      await expect(runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "TIMEOUT" });
      expect(calls.ollama).toHaveBeenCalledTimes(1);
      expect(calls.openrouter).not.toHaveBeenCalled();
      expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("rejects a late second-provider result instead of exceeding the total budget", async () => {
    let now = 0;
    const deadline = new AIRequestDeadline(new AbortController().signal, 6000, () => now);
    calls.ollama.mockImplementation(async () => { now = 1000; throw new AIGatewayError("TIMEOUT"); });
    calls.openrouter.mockImplementation(async () => { now = 6100; return { text: "late", provider: "openrouter", model: "fake" }; });
    try {
      await expect(runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "TIMEOUT" });
      expect(calls.ollama).toHaveBeenCalledTimes(1);
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      expect(calls.openai).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("keeps ordinary success and one cloud reservation for Auto fallback", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("TIMEOUT"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    const diagnostics = new AIRequestDiagnostics("plan");
    try {
      const result = await runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline, diagnostics);
      expect(result).toMatchObject({ provider: "openrouter", routing: { reason: "fallback_after_provider_error" } });
      expect(diagnostics.snapshot("SUCCESS")).not.toHaveProperty("failureOrigin");
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });
});
