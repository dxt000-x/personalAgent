import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAiGateway } from "../gateway";
import { AIGatewayError } from "../errors";
import { getProvider, getProviderStatuses } from "../provider-registry";
import { reserveCloudAiQuota } from "../quota";
import { AIRequestDeadline } from "../request-deadline";
import type { createClient } from "@/lib/supabase/server";
import type { AIProvider, ProviderId, ProviderStatus } from "../types";

vi.mock("../provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("../quota", () => ({ reserveCloudAiQuota: vi.fn() }));

const ids: ProviderId[] = ["ollama", "openrouter", "groq", "openai", "deepseek", "gemini"];
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
    try {
      const result = await runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline);
      expect(result).toMatchObject({ provider: "openrouter", routing: { reason: "fallback_after_provider_error" } });
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });

  it("uses one reservation for explicit Groq and never falls back", async () => {
    calls.groq.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "groq", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "PROVIDER_ERROR" });
      expect(calls.groq).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      for (const id of ids.filter((id) => id !== "groq")) expect(calls[id]).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("fails closed before Groq when quota is unavailable", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("QUOTA_UNAVAILABLE"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "groq", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: "QUOTA_UNAVAILABLE" });
      expect(calls.groq).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("uses one reservation when Auto falls back OpenRouter to Groq", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      expect(await runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .toMatchObject({ provider: "groq", routing: { reason: "fallback_after_provider_error" } });
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
      expect(calls.groq).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });

  it.each([400, 401, 402, 403, 404, 405, 409, 413, 415, 422, 429])("does not fall back or reserve again after upstream HTTP %i", async (status) => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(Object.assign(new Error("fake secret upstream detail"), { status }));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code: status === 429 ? "RATE_LIMITED"
          : status === 401 || status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REQUEST_REJECTED",
        status: status === 429 ? 429 : 502 });
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
      expect(calls.groq).not.toHaveBeenCalled();
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });

  it("treats upstream HTTP 408 as recoverable TIMEOUT with one cloud reservation", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(Object.assign(new Error("fake upstream timeout"), { status: 408 }));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      expect(await runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .toMatchObject({ provider: "groq", routing: { reason: "fallback_after_provider_error" } });
      expect(calls.openrouter).toHaveBeenCalledTimes(1);
      expect(calls.groq).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });

  it("still falls back on an actual upstream HTTP 503", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(Object.assign(new Error("fake upstream outage"), { status: 503 }));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      expect(await runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .toMatchObject({ provider: "groq", routing: { reason: "fallback_after_provider_error" } });
      expect(calls.groq).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    } finally { deadline.close(); }
  });

  it.each([401, 403])("fails explicit Groq safely on upstream HTTP %i", async (status) => {
    calls.groq.mockRejectedValue(Object.assign(new Error("fake secret upstream detail"), { status }));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      const pending = runAiGateway(client, { provider: "groq", routingPreference: "auto", messages }, deadline);
      await expect(pending).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED", status: 502,
        message: "模型服务认证或权限校验失败，请检查服务配置。" });
      expect(calls.groq).toHaveBeenCalledTimes(1);
      expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
      for (const id of ids.filter((id) => id !== "groq")) expect(calls[id]).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it.each(["RATE_LIMITED", "CLOUD_QUOTA_EXCEEDED"] as const)("does not fall back to Groq after %s", async (code) => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(new AIGatewayError(code));
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "auto", routingPreference: "auto", messages }, deadline))
        .rejects.toMatchObject({ code });
      expect(calls.groq).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });

  it("rejects Privacy with explicit Groq before quota or provider calls", async () => {
    const deadline = new AIRequestDeadline(new AbortController().signal);
    try {
      await expect(runAiGateway(client, { provider: "groq", routingPreference: "privacy", messages,
        systemInstruction: "fake private memory" }, deadline)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(calls.groq).not.toHaveBeenCalled();
      expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    } finally { deadline.close(); }
  });
});
