import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIGatewayError } from "../errors";
import { getAutoRoute, MAX_AUTO_PROVIDER_ATTEMPTS } from "../router";
import { getProviderStatuses } from "../provider-registry";
import type { ProviderId, ProviderStatus } from "../types";

vi.mock("../provider-registry", () => ({ getProviderStatuses: vi.fn() }));

const ids: ProviderId[] = ["ollama", "openrouter", "openai", "deepseek", "gemini"];
const cloudIds: ProviderId[] = ids.filter((id) => id !== "ollama");

function statuses(configured: ProviderId[], ollamaAvailable = false): ProviderStatus[] {
  return ids.map((id) => ({
    id,
    type: id === "ollama" ? "local" : "cloud",
    configured: configured.includes(id),
    availability: id === "ollama" ? ollamaAvailable ? "available" : "unavailable" : configured.includes(id) ? "unknown" : "unavailable",
    model: `fake-${id}`,
  }));
}

beforeEach(() => vi.mocked(getProviderStatuses).mockReset());

describe("deterministic Auto router", () => {
  it("prefers available Ollama before cloud providers", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(ids, true));
    const route = await getAutoRoute({ preference: "auto" });
    expect(route.map(({ provider }) => provider)).toEqual(["ollama", "openrouter"]);
    expect(route[0].reason).toBe("local_provider_available");
  });

  it("starts with OpenRouter when Ollama is unavailable", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(ids));
    const route = await getAutoRoute({ preference: "auto" });
    expect(route.map(({ provider }) => provider)).toEqual(["openrouter", "openai"]);
  });

  it("continues through the existing cloud priority when OpenRouter is absent", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(["ollama", "openai", "deepseek", "gemini"]));
    expect((await getAutoRoute({ preference: "auto" })).map(({ provider }) => provider)).toEqual(["openai", "deepseek"]);
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(["ollama", "gemini"]));
    expect((await getAutoRoute({ preference: "auto" })).map(({ provider }) => provider)).toEqual(["gemini"]);
  });

  it("skips an unavailable OpenRouter before considering other cloud providers", async () => {
    const providerStatuses = statuses(ids);
    providerStatuses.find(({ id }) => id === "openrouter")!.availability = "unavailable";
    vi.mocked(getProviderStatuses).mockResolvedValue(providerStatuses);
    expect((await getAutoRoute({ preference: "auto" })).map(({ provider }) => provider)).toEqual(["openai", "deepseek"]);
  });

  it("never returns more than the configured attempt limit", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(ids, true));
    expect((await getAutoRoute({ preference: "auto" })).length).toBe(MAX_AUTO_PROVIDER_ATTEMPTS);
  });

  it("returns only Ollama for Privacy even with all cloud providers configured", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(ids, true));
    const route = await getAutoRoute({ preference: "privacy" });
    expect(route).toEqual([{ provider: "ollama", model: "fake-ollama", reason: "privacy_local_only" }]);
    expect(route.some(({ provider }) => cloudIds.includes(provider))).toBe(false);
  });

  it("fails closed for Privacy when Ollama is unavailable", async () => {
    vi.mocked(getProviderStatuses).mockResolvedValue(statuses(ids));
    await expect(getAutoRoute({ preference: "privacy" })).rejects.toMatchObject({
      code: "PRIVACY_PROVIDER_UNAVAILABLE",
    } satisfies Partial<AIGatewayError>);
  });
});
