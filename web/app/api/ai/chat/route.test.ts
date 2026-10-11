import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
import { getProvider, getProviderStatuses } from "@/lib/ai/provider-registry";
import { reserveCloudAiQuota } from "@/lib/ai/quota";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";
import { createClient } from "@/lib/supabase/server";
import type { ProviderId, ProviderStatus } from "@/lib/ai/types";

vi.mock("@/lib/ai/provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("@/lib/ai/quota", () => ({ reserveCloudAiQuota: vi.fn() }));
vi.mock("@/lib/memories/context", () => ({ retrievePersonalMemoryContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ids: ProviderId[] = ["ollama", "openrouter", "groq", "openai", "deepseek", "gemini"];
const cloudIds: ProviderId[] = ["openrouter", "groq", "openai", "deepseek", "gemini"];
const calls = {
  ollama: vi.fn(),
  openrouter: vi.fn(),
  groq: vi.fn(),
  openai: vi.fn(),
  deepseek: vi.fn(),
  gemini: vi.fn(),
};

function statuses(ollamaAvailable = true): ProviderStatus[] {
  return ids.map((id) => ({
    id,
    type: id === "ollama" ? "local" : "cloud",
    configured: true,
    availability: id === "ollama" ? ollamaAvailable ? "available" : "unavailable" : "unknown",
    model: `fake-${id}`,
  }));
}

function request(provider: ProviderId | "auto" = "auto", routingPreference: "auto" | "privacy" = "auto", messages = [{ role: "user", content: "hello" }]) {
  return new Request("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, routingPreference, messages }),
  });
}

async function responseFor(provider: ProviderId | "auto" = "auto", preference: "auto" | "privacy" = "auto") {
  const response = await POST(request(provider, preference));
  return { response, body: await response.json() };
}

function expectNoCloudCalls() {
  for (const id of cloudIds) expect(calls[id]).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  const fakeClient = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "fake-user" } }, error: null }) } };
  vi.mocked(createClient).mockResolvedValue(fakeClient as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
  vi.mocked(getProviderStatuses).mockResolvedValue(statuses());
  vi.mocked(reserveCloudAiQuota).mockResolvedValue({ remainingCount: 29 });
  vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({ metadata: { status: "none", used: false, count: 0 } });
  for (const id of ids) calls[id].mockResolvedValue({ text: "fake reply", provider: id, model: `fake-${id}` });
  vi.mocked(getProvider).mockImplementation((id) => ({ generate: calls[id] }));
});

describe("POST /api/ai/chat with fake providers", () => {
  it("rejects unauthenticated requests before reading Memory or routing", async () => {
    vi.mocked(createClient).mockResolvedValue(null);
    const { response, body } = await responseFor();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(retrievePersonalMemoryContext).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("does not treat failed claims verification as a Memory outage", async () => {
    const client = await createClient();
    if (!client) throw new Error("fake client missing");
    vi.mocked(client.auth.getClaims).mockResolvedValue({ data: { claims: null }, error: new Error("fake auth failure") } as never);
    const { response, body } = await responseFor();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(retrievePersonalMemoryContext).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("rejects invalid input without calling a provider", async () => {
    const response = await POST(request("auto", "auto", []));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("returns a successful reply without Memory", async () => {
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ provider: "ollama", text: "fake reply", memory: { status: "none" } });
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    expect(calls.ollama.mock.calls[0][2]).toBeUndefined();
  });

  it("passes server-constructed Memory context to the selected provider", async () => {
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "fake server Memory context",
      metadata: { status: "used", used: true, count: 1 },
    });
    const { body } = await responseFor();
    expect(body.memory).toEqual({ status: "used", used: true, count: 1 });
    expect(calls.ollama.mock.calls[0][2]).toBe("fake server Memory context");
    expect(JSON.stringify(body)).not.toContain("fake server Memory context");
  });

  it("continues normally when Memory retrieval is unavailable", async () => {
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({ metadata: { status: "unavailable", used: false, count: 0 } });
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.memory.status).toBe("unavailable");
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(calls.ollama.mock.calls[0][2]).toBeUndefined();
  });

  it("keeps Privacy on Ollama with Memory context and never calls cloud providers", async () => {
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "fake private Memory context",
      metadata: { status: "used", used: true, count: 1 },
    });
    const { response, body } = await responseFor("auto", "privacy");
    expect(response.status).toBe(200);
    expect(body.provider).toBe("ollama");
    expect(calls.ollama.mock.calls[0][2]).toBe("fake private Memory context");
    expectNoCloudCalls();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("fails Privacy closed when Ollama is unavailable, even with Memory", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "fake private Memory context",
      metadata: { status: "used", used: true, count: 1 },
    });
    const { response, body } = await responseFor("auto", "privacy");
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PRIVACY_PROVIDER_UNAVAILABLE");
    expect(calls.ollama).not.toHaveBeenCalled();
    expectNoCloudCalls();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("never switches Privacy to cloud after an Ollama failure with Memory", async () => {
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "fake private Memory context",
      metadata: { status: "used", used: true, count: 1 },
    });
    calls.ollama.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response, body } = await responseFor("auto", "privacy");
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expectNoCloudCalls();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it.each(ids)("does not fallback from explicit %s after an upstream error", async (id) => {
    calls[id].mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response, body } = await responseFor(id);
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(calls[id]).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(id === "ollama" ? 0 : 1);
    for (const other of ids.filter((candidate) => candidate !== id)) expect(calls[other]).not.toHaveBeenCalled();
  });

  it.each([401, 403])("returns a safe 502 for explicit Groq upstream HTTP %i", async (status) => {
    calls.groq.mockRejectedValue(Object.assign(new Error("fake-upstream-secret"), { status }));
    const { response, body } = await responseFor("groq");
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_AUTH_FAILED");
    expect(JSON.stringify(body)).not.toContain("fake-upstream-secret");
    expect(calls.groq).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    for (const other of ids.filter((id) => id !== "groq")) expect(calls[other]).not.toHaveBeenCalled();
  });

  it.each(["PROVIDER_ERROR", "TIMEOUT"] as const)("falls back once after %s", async (code) => {
    calls.ollama.mockRejectedValue(new AIGatewayError(code));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ provider: "openrouter", routing: { reason: "fallback_after_provider_error" } });
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    for (const id of ["openai", "deepseek", "gemini"] as const) expect(calls[id]).not.toHaveBeenCalled();
  });

  it.each(["AUTH_REQUIRED", "INVALID_REQUEST", "RATE_LIMITED"] as const)("does not fallback after %s", async (code) => {
    calls.ollama.mockRejectedValue(new AIGatewayError(code));
    const { body } = await responseFor();
    expect(body.error.code).toBe(code);
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expectNoCloudCalls();
  });

  it("stops after two failed Auto candidates", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    calls.openrouter.mockRejectedValue(new AIGatewayError("TIMEOUT"));
    const { response, body } = await responseFor();
    expect(response.status).toBe(504);
    expect(body.error.code).toBe("TIMEOUT");
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    for (const id of ["openai", "deepseek", "gemini"] as const) expect(calls[id]).not.toHaveBeenCalled();
  });

  it.each(cloudIds)("reserves once before explicit %s", async (id) => {
    const { response, body } = await responseFor(id);
    expect(response.status).toBe(200);
    expect(body.provider).toBe(id);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls[id]).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reserveCloudAiQuota).mock.invocationCallOrder[0]).toBeLessThan(calls[id].mock.invocationCallOrder[0]);
  });

  it("does not reserve for explicit Ollama", async () => {
    const { response } = await responseFor("ollama");
    expect(response.status).toBe(200);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("keeps local Auto and Privacy working when the quota database is unavailable", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("QUOTA_UNAVAILABLE"));
    const automatic = await responseFor();
    const privacy = await responseFor("auto", "privacy");
    expect(automatic.response.status).toBe(200);
    expect(privacy.response.status).toBe(200);
    expect(automatic.body.provider).toBe("ollama");
    expect(privacy.body.provider).toBe("ollama");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    expectNoCloudCalls();
  });

  it("reserves once before Auto selects OpenRouter without a local candidate", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.provider).toBe("openrouter");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it("reserves once after Ollama fails and before the cloud fallback", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.provider).toBe("openrouter");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls.ollama.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reserveCloudAiQuota).mock.invocationCallOrder[0]);
  });

  it("does not reserve twice when one cloud provider falls back to another", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.provider).toBe("groq");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(calls.groq).toHaveBeenCalledTimes(1);
  });

  it("returns a safe 429 and never calls cloud when quota is exhausted", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("CLOUD_QUOTA_EXCEEDED"));
    const { response, body } = await responseFor("openrouter");
    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({ code: "CLOUD_QUOTA_EXCEEDED" });
    expect(body.error.message).toContain("今日云端 AI 使用次数已达到上限");
    expectNoCloudCalls();
  });

  it("fails cloud closed when quota storage is unavailable", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("QUOTA_UNAVAILABLE"));
    const { response, body } = await responseFor("openrouter");
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
    expectNoCloudCalls();
  });

  it("does not bypass an unavailable quota store through Auto cloud fallback", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("QUOTA_UNAVAILABLE"));
    const { response, body } = await responseFor();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expectNoCloudCalls();
  });

  it("does not charge when a cloud provider is unconfigured before invocation", async () => {
    vi.mocked(getProvider).mockImplementation((id) => {
      if (id === "openrouter") throw new AIGatewayError("PROVIDER_NOT_CONFIGURED");
      return { generate: calls[id] };
    });
    const { response, body } = await responseFor("openrouter");
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    expectNoCloudCalls();
  });
});
