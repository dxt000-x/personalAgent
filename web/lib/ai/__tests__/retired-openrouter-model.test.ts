import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider, getProviderStatuses, resolveOpenRouterModel } from "../provider-registry";

const adapter = vi.hoisted(() => vi.fn(() => ({ generate: vi.fn() })));
vi.mock("../openrouter-provider", () => ({ createOpenRouterProvider: adapter }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("retired OpenRouter models use the existing free route", () => {
  it.each(["liquid/lfm-2.5-2.6b", "liquid/lfm-2.5-2.6b:free", " liquid/lfm-2.5-2.6b:free "])("maps only the retired exact alias %s", model => {
    expect(resolveOpenRouterModel(model)).toBe("openrouter/free");
  });
  it.each([undefined, "", "  ", "openrouter/free"])("retains the established default for %s", model => {
    expect(resolveOpenRouterModel(model)).toBe("openrouter/free");
  });
  it.each(["vendor/approved", "liquid/other", "LIQUID/lfm-2.5-2.6b", "liquid/lfm-2.5-2.6b:unknown"])("does not rewrite unrelated configuration %s", model => {
    expect(resolveOpenRouterModel(model)).toBe(model);
  });
  it("uses the resolved model in the actual adapter and advertised status", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
    vi.stubEnv("OPENROUTER_MODEL", "liquid/lfm-2.5-2.6b:free");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    getProvider("openrouter");
    expect(adapter).toHaveBeenCalledWith("fixture-key", "openrouter/free");
    expect((await getProviderStatuses()).find(p => p.id === "openrouter")?.model).toBe("openrouter/free");
    expect(process.env.OPENROUTER_MODEL).toBe("liquid/lfm-2.5-2.6b:free");
  });
});
