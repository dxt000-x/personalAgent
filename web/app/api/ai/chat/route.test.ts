import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AIGatewayError } from "@/lib/ai/errors";
import { getProvider, getProviderStatuses } from "@/lib/ai/provider-registry";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";
import { createClient } from "@/lib/supabase/server";
import type { ProviderId, ProviderStatus } from "@/lib/ai/types";

vi.mock("@/lib/ai/provider-registry", () => ({ getProvider: vi.fn(), getProviderStatuses: vi.fn() }));
vi.mock("@/lib/memories/context", () => ({ retrievePersonalMemoryContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

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
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("rejects invalid input without calling a provider", async () => {
    const response = await POST(request("auto", "auto", []));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    for (const id of ids) expect(calls[id]).not.toHaveBeenCalled();
  });

  it("returns a successful reply without Memory", async () => {
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ provider: "ollama", text: "fake reply", memory: { status: "none" } });
    expect(calls.ollama).toHaveBeenCalledTimes(1);
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
  });

  it.each(ids)("does not fallback from explicit %s after an upstream error", async (id) => {
    calls[id].mockRejectedValue(new AIGatewayError("PROVIDER_ERROR"));
    const { response, body } = await responseFor(id);
    expect(response.status).toBe(502);
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(calls[id]).toHaveBeenCalledTimes(1);
    for (const other of ids.filter((candidate) => candidate !== id)) expect(calls[other]).not.toHaveBeenCalled();
  });

  it.each(["PROVIDER_ERROR", "TIMEOUT"] as const)("falls back once after %s", async (code) => {
    calls.ollama.mockRejectedValue(new AIGatewayError(code));
    const { response, body } = await responseFor();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ provider: "openrouter", routing: { reason: "fallback_after_provider_error" } });
    expect(calls.ollama).toHaveBeenCalledTimes(1);
    expect(calls.openrouter).toHaveBeenCalledTimes(1);
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
    for (const id of ["openai", "deepseek", "gemini"] as const) expect(calls[id]).not.toHaveBeenCalled();
  });
});
