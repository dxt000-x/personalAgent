import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
import { getProvider, getProviderStatuses } from "@/lib/ai/provider-registry";
import { reserveCloudAiQuota } from "@/lib/ai/quota";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";
import { createClient } from "@/lib/supabase/server";
import { searchKnowledgeChunks } from "@/lib/knowledge/search";
import type { ProviderId, ProviderStatus } from "@/lib/ai/types";

vi.mock("@/lib/ai/provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("@/lib/ai/quota", () => ({ reserveCloudAiQuota: vi.fn() }));
vi.mock("@/lib/memories/context", () => ({ retrievePersonalMemoryContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/knowledge/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/search")>()), searchKnowledgeChunks: vi.fn(),
}));

const ids: ProviderId[] = ["ollama", "openrouter", "openai", "deepseek", "gemini"];
const cloudIds: ProviderId[] = ["openrouter", "openai", "deepseek", "gemini"];
const calls = {
  ollama: vi.fn(),
  openrouter: vi.fn(),
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
  vi.mocked(searchKnowledgeChunks).mockResolvedValue([]);
  for (const id of ids) calls[id].mockResolvedValue({ text: "fake reply", provider: id, model: `fake-${id}` });
  vi.mocked(getProvider).mockImplementation((id) => ({ generate: calls[id] }));
});

describe("POST /api/ai/chat with fake providers", () => {
  it("does not request the Plan-only OpenRouter output override", async () => {
    const { response } = await responseFor("openrouter");
    expect(response.status).toBe(200);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(calls.openrouter.mock.calls[0][3]).not.toHaveProperty("openRouterMaxOutputTokens");
  });

  const source = { documentId: "11111111-1111-4111-8111-111111111111", fileName: "notes.txt",
    chunkIndex: 0, snippet: "TCP 是传输协议" };
  const knowledgeRequest = (knowledge: unknown, provider: ProviderId | "auto" = "ollama",
    routingPreference: "auto" | "privacy" = "auto") => new Request("http://localhost:3000/api/ai/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, routingPreference, messages: [{ role: "user", content: "请解释 TCP" }], knowledge }),
  });

  it("does not query knowledge when the opt-in field is absent", async () => {
    await responseFor();
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
  });

  it("uses only server-retrieved ready snippets and reports the injected sources", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([source]);
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(searchKnowledgeChunks).toHaveBeenCalledWith(expect.anything(), "fake-user", "TCP", undefined, expect.any(AbortSignal));
    expect(calls.ollama.mock.calls[0][2]).toContain("不可信引用资料");
    expect(calls.ollama.mock.calls[0][2]).toContain(source.snippet);
    expect(body.knowledge).toEqual({ status: "used", sources: [source] });
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("returns only the exact sources that fit into the provider context", async () => {
    const excluded = { ...source, documentId: "22222222-2222-4222-8222-222222222222", snippet: "第二条未注入的资料" };
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([source, excluded]);
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "m".repeat(15_780), metadata: { status: "used", used: true, count: 1 },
    });
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.knowledge.sources).toEqual([source]);
    const injected = String(calls.ollama.mock.calls[0][2]);
    expect(injected).toContain(source.snippet);
    expect(injected).not.toContain(excluded.snippet);
  });

  it("returns no_match before model invocation or cloud quota reservation", async () => {
    vi.mocked(retrievePersonalMemoryContext).mockResolvedValue({
      systemInstruction: "private memory", metadata: { status: "used", used: true, count: 1 },
    });
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }, "openrouter"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      knowledge: { status: "no_match", sources: [] }, memory: { status: "omitted", used: false, count: 0 },
    });
    expect(retrievePersonalMemoryContext).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it.each([{}, { enabled: true, query: "%" }, { enabled: true, query: "TCP", userId: "other" },
    { enabled: true, query: "TCP", sources: [source] }])("rejects untrusted knowledge input %#", async (knowledge) => {
    const response = await POST(knowledgeRequest(knowledge));
    expect(response.status).toBe(400);
    expect(searchKnowledgeChunks).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("fails closed with a fixed error when knowledge retrieval fails", async () => {
    vi.mocked(searchKnowledgeChunks).mockRejectedValue(new Error("private SQL and content"));
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("KNOWLEDGE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("private SQL");
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("keeps Privacy local with knowledge and never reserves cloud quota", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([source]);
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }, "auto", "privacy"));
    expect(response.status).toBe(200);
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expectNoCloudCalls();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("preserves Auto fallback and a single cloud reservation after knowledge retrieval", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([source]);
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }, "auto"));
    expect(response.status).toBe(200);
    expect((await response.json()).knowledge.sources).toEqual([source]);
    expect(calls.openai).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it("does not fallback after an upstream 401 with knowledge enabled", async () => {
    vi.mocked(searchKnowledgeChunks).mockResolvedValue([source]);
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue({ status: 401, message: "private token" });
    const response = await POST(knowledgeRequest({ enabled: true, query: "TCP" }, "auto"));
    expect((await response.json()).error.code).toBe("PROVIDER_AUTH_FAILED");
    expect(calls.openai).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });
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
    expect(body.provider).toBe("openai");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(calls.openai).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 422, 429])("does not fall back or reserve twice after upstream HTTP %i", async (status) => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue({ status, message: "sk-test-secret-do-not-leak" });
    const { response, body } = await responseFor();
    expect(response.status).toBe(status === 429 ? 429 : 502);
    expect(body.error.code).toBe(status === 429 ? "RATE_LIMITED"
      : status === 401 || status === 403 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REQUEST_REJECTED");
    expect(JSON.stringify(body)).not.toContain("sk-test-secret-do-not-leak");
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(calls.openai).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it.each([503, undefined])("keeps Auto fallback for upstream %s", async (status) => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue(status ? { status } : new Error("fake network failure"));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.provider).toBe("openai");
    expect(calls.openai).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it("allows timeout fallback but never reserves cloud quota twice", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(false));
    calls.openrouter.mockRejectedValue({ status: 408 });
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.provider).toBe("openai");
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("does not fall back from explicit OpenRouter upstream HTTP %i", async (status) => {
    calls.openrouter.mockRejectedValue({ status, message: "sk-test-secret-do-not-leak" });
    const { response, body } = await responseFor("openrouter");
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_AUTH_FAILED");
    expect(JSON.stringify(body)).not.toContain("sk-test-secret-do-not-leak");
    expect(calls.openai).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it("keeps Privacy local-only after an upstream authentication failure", async () => {
    calls.ollama.mockRejectedValue({ status: 401, message: "sk-test-secret-do-not-leak" });
    const { response, body } = await responseFor("auto", "privacy");
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_AUTH_FAILED");
    expectNoCloudCalls();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
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
