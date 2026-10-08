import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderStatuses } from "../provider-registry";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY"] as const) {
    vi.stubEnv(key, `fake-${key.toLowerCase()}`);
  }
  vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: [{ name: "qwen3:8b" }] }),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider status classification", () => {
  it("reports Ollama as local and all existing cloud providers as cloud", async () => {
    const statuses = await getProviderStatuses();
    expect(Object.fromEntries(statuses.map(({ id, type }) => [id, type]))).toEqual({
      ollama: "local",
      openrouter: "cloud",
      openai: "cloud",
      deepseek: "cloud",
      gemini: "cloud",
    });
    expect(statuses.find(({ id }) => id === "ollama")?.availability).toBe("available");
    for (const status of statuses.filter(({ type }) => type === "cloud")) {
      expect(status).toMatchObject({ configured: true, availability: "unknown" });
    }
  });
});
