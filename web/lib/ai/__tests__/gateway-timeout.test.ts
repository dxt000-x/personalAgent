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
});
