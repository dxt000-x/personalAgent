import { describe, expect, it } from "vitest";
import { rankMemories, type RankableMemory } from "./rank";

const now = Date.parse("2026-10-14T12:00:00Z");

function item(id: string, overrides: Partial<RankableMemory> = {}): RankableMemory {
  return {
    id, content: `记忆 ${id}`, category: "other", importance: 3,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("deterministic Memory ranking", () => {
  it("keeps importance as the primary signal when no content is relevant", () => {
    const older = item("important", { importance: 5, created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z" });
    const recent = item("recent", { importance: 1, created_at: "2026-10-14T00:00:00Z",
      updated_at: "2026-10-14T00:00:00Z" });
    expect(rankMemories([recent, older], "无关问题", now).map(({ id }) => id)).toEqual(["important", "recent"]);
  });

  it("promotes a relevant lower-importance memory over an unrelated older one", () => {
    const old = item("old", { importance: 5 });
    const relevant = item("relevant", { importance: 1, content: "我使用 TypeScript 开发项目",
      updated_at: "2026-10-14T00:00:00Z" });
    expect(rankMemories([old, relevant], "TypeScript", now)[0].id).toBe("relevant");
  });

  it("matches Chinese terms and applies a category hint only for matching intent", () => {
    const preference = item("preference", { category: "preference", content: "我喜欢中文界面" });
    const other = item("other", { content: "我喜欢中文界面" });
    expect(rankMemories([other, preference], "我喜欢中文界面吗", now)[0].id).toBe("preference");
    expect(rankMemories([other, preference], "无关问题", now).map(({ id }) => id)).toEqual(["other", "preference"]);
  });

  it("uses a mild time factor without eliminating old important facts", () => {
    const old = item("old", { importance: 5 });
    const edited = item("edited", { importance: 5, updated_at: "2026-10-14T00:00:00Z" });
    expect(rankMemories([old, edited], "无关问题", now).map(({ id }) => id)).toEqual(["edited", "old"]);
  });

  it("resolves exact ties by ID and never mutates the input", () => {
    const inputs = [item("b"), item("a")];
    expect(rankMemories(inputs, "无关问题", now).map(({ id }) => id)).toEqual(["a", "b"]);
    expect(inputs.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("caps matching work for long messages and handles empty text", () => {
    const inputs = [item("b"), item("a")];
    expect(rankMemories(inputs, "x ".repeat(4_000), now)).toHaveLength(2);
    expect(rankMemories(inputs, "", now)).toHaveLength(2);
  });
});
