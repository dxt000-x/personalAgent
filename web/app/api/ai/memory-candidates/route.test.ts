import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
import { runAiGateway } from "@/lib/ai/gateway";
import { getProvider, getProviderStatuses } from "@/lib/ai/provider-registry";
import { reserveCloudAiQuota } from "@/lib/ai/quota";
import { createClient } from "@/lib/supabase/server";
import type { AIProvider, ProviderId, ProviderStatus } from "@/lib/ai/types";

vi.mock("@/lib/ai/provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("@/lib/ai/quota", () => ({ reserveCloudAiQuota: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ids: ProviderId[] = ["ollama", "openrouter", "openai", "deepseek", "gemini"];
const calls = Object.fromEntries(ids.map((id) => [id, vi.fn<AIProvider["generate"]>()])) as Record<ProviderId, ReturnType<typeof vi.fn<AIProvider["generate"]>>>;
const stored: { content: string }[] = [];
const eq = vi.fn();

function status(localAvailable = true): ProviderStatus[] {
  return ids.map((id) => ({ id, type: id === "ollama" ? "local" : "cloud", configured: true,
    availability: id === "ollama" ? localAvailable ? "available" : "unavailable" : "unknown", model: `fake-${id}` }));
}

function request(message = "我长期使用 TypeScript", provider: ProviderId | "auto" = "auto", routingPreference = "auto") {
  return new Request("http://localhost:3000/api/ai/memory-candidates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, provider, routingPreference }),
  });
}

async function responseFor(message?: string, provider?: ProviderId | "auto", preference?: string) {
  const response = await POST(request(message, provider, preference));
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.resetAllMocks();
  stored.length = 0;
  const abortSignal = vi.fn().mockImplementation(async () => ({ data: stored, error: null }));
  const limit = vi.fn().mockReturnValue({ abortSignal });
  eq.mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null }) }, from };
  vi.mocked(createClient).mockResolvedValue(client as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
  vi.mocked(getProviderStatuses).mockResolvedValue(status());
  vi.mocked(reserveCloudAiQuota).mockResolvedValue({ remainingCount: 29 });
  for (const id of ids) calls[id].mockResolvedValue({ text: JSON.stringify({ candidates: [{ content: "我长期使用 TypeScript", category: "preference", importance: 3, reason: "长期偏好" }] }), provider: id, model: `fake-${id}` });
  vi.mocked(getProvider).mockImplementation((id) => ({ generate: calls[id] }));
});

describe("POST /api/ai/memory-candidates", () => {
  it("requires authentication and does not invoke a provider or quota", async () => {
    vi.mocked(createClient).mockResolvedValue(null);
    const { response, body } = await responseFor();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("uses one user message and trusted system instruction, with no other Memory context", async () => {
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(1);
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(calls.ollama.mock.calls[0][0]).toEqual([{ role: "user", content: "我长期使用 TypeScript" }]);
    expect(calls.ollama.mock.calls[0][2]).toContain("只分析接下来单条用户消息");
    expect(eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("deduplicates against authenticated user's saved memories", async () => {
    stored.push({ content: "我 长期使用 TypeScript。" });
    const { body } = await responseFor();
    expect(body.candidates).toEqual([]);
  });

  it("never calls cloud in Privacy, including when Ollama fails", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response } = await responseFor(undefined, "auto", "privacy");
    expect(response.status).toBe(502);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("fails Privacy closed when the local model is unavailable", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(status(false));
    const { response, body } = await responseFor(undefined, "auto", "privacy");
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PRIVACY_PROVIDER_UNAVAILABLE");
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it.each(["openrouter", "openai", "deepseek", "gemini"] as const)("rejects explicit cloud %s with Privacy before model or quota work", async (provider) => {
    const { response, body } = await responseFor(undefined, provider, "privacy");
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(getProvider).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("keeps explicit Ollama with Privacy local-only", async () => {
    const { response } = await responseFor(undefined, "ollama", "privacy");
    expect(response.status).toBe(200);
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("guards shared Gateway against Privacy/cloud conflict even without route validation", async () => {
    const client = await createClient();
    if (!client) throw new Error("fake client missing");
    await expect(runAiGateway(client, {
      provider: "openrouter", routingPreference: "privacy", messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(getProvider).not.toHaveBeenCalled();
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
  });

  it("reserves independent cloud quota before explicit extraction", async () => {
    const { response } = await responseFor(undefined, "openrouter");
    expect(response.status).toBe(200);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reserveCloudAiQuota).mock.invocationCallOrder[0]).toBeLessThan(calls.openrouter.mock.invocationCallOrder[0]);
  });

  it("reserves once when Auto falls back from local to cloud", async () => {
    calls.ollama.mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response } = await responseFor();
    expect(response.status).toBe(200);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
  });

  it("reserves once across two cloud candidates", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(status(false));
    calls.openrouter.mockRejectedValue(new AIGatewayError("TIMEOUT"));
    const { response } = await responseFor();
    expect(response.status).toBe(200);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
    expect(calls.openai).toHaveBeenCalledTimes(1);
    expect(reserveCloudAiQuota).toHaveBeenCalledTimes(1);
  });

  it("never calls cloud when quota is exhausted", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("CLOUD_QUOTA_EXCEEDED"));
    const { response, body } = await responseFor(undefined, "openrouter");
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("CLOUD_QUOTA_EXCEEDED");
    for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("fails cloud closed when quota storage is unavailable", async () => {
    vi.mocked(reserveCloudAiQuota).mockRejectedValue(new AIGatewayError("QUOTA_UNAVAILABLE"));
    const { response, body } = await responseFor(undefined, "openrouter");
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
    for (const id of ids.filter((id) => id !== "ollama")) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("rejects invalid input before quota or model work", async () => {
    const response = await POST(new Request("http://localhost:3000/api/ai/memory-candidates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "auto", routingPreference: "auto", message: "", user_id: "user-b" }),
    }));
    expect(response.status).toBe(400);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("safely rejects malformed model JSON and likely credentials", async () => {
    calls.ollama.mockResolvedValue({ text: "secret invalid JSON", provider: "ollama", model: "fake" });
    const bad = await responseFor();
    expect(bad.response.status).toBe(502);
    expect(JSON.stringify(bad.body)).not.toContain("secret invalid JSON");
    const sensitive = await responseFor("密码：abc123");
    expect(sensitive.body.candidates).toEqual([]);
    expect(calls.ollama).toHaveBeenCalledTimes(1);
  });

  it.each(["token=obvious-fake-value", "test@example.invalid", "13800138000"])("does not forward obvious sensitive input to an extra model call: %s", async (message) => {
    const { response, body } = await responseFor(message, "openrouter");
    expect(response.status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(reserveCloudAiQuota).not.toHaveBeenCalled();
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });
});
