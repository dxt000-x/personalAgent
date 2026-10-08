import { describe, expect, it } from "vitest";
import { containsSensitiveMaterial, normalizeMemoryContent, parseMemoryCandidates, validateCandidateRequest } from "./memory-candidates";

const candidate = (content: string, category = "preference") => ({ content, category, importance: 3, reason: "长期偏好" });
const output = (...rows: unknown[]) => JSON.stringify({ candidates: rows });

describe("memory candidate boundaries", () => {
  it("accepts a stated long-term preference and ongoing project from model output", () => {
    expect(parseMemoryCandidates(output(candidate("我长期偏好用 TypeScript"), candidate("我正在开发 Personal AI Assistant", "work")), [])).toHaveLength(2);
  });

  it("accepts an empty model decision for greetings and temporary questions", () => {
    expect(parseMemoryCandidates(output(), [])).toEqual([]);
  });

  it("rejects illegal categories, malformed JSON and extra model fields", () => {
    expect(() => parseMemoryCandidates(output(candidate("项目", "secret")), [])).toThrow();
    expect(() => parseMemoryCandidates("not json", [])).toThrow();
    expect(() => parseMemoryCandidates(output({ ...candidate("项目"), user_id: "other" }), [])).toThrow();
  });

  it("accepts a JSON code fence but still validates the exact schema", () => {
    expect(parseMemoryCandidates(`\`\`\`json\n${output(candidate("我长期使用 TypeScript"))}\n\`\`\``, [])).toHaveLength(1);
    expect(() => parseMemoryCandidates(`说明：${output(candidate("项目"))}`, [])).toThrow();
  });

  it("enforces three candidates, content length and reason length", () => {
    expect(() => parseMemoryCandidates(output(...Array(4).fill(candidate("项目"))), [])).toThrow();
    expect(() => parseMemoryCandidates(output(candidate("x".repeat(501))), [])).toThrow();
    expect(() => parseMemoryCandidates(output({ ...candidate("项目"), reason: "x".repeat(161) }), [])).toThrow();
  });

  it("normalizes exact and simple punctuation/spacing duplicates for the current user", () => {
    expect(normalizeMemoryContent("Ａ Ｉ，助手。") ).toBe(normalizeMemoryContent("AI助手"));
    expect(parseMemoryCandidates(output(candidate("我 长期使用 TypeScript。"), candidate("我在开发新项目", "work")), ["我长期使用 TypeScript"])).toHaveLength(1);
    expect(parseMemoryCandidates(output(candidate("我在开发新项目"), candidate("我在开发新项目。")), [])).toHaveLength(1);
  });

  it("filters likely secrets and rejects invalid extraction input", () => {
    expect(containsSensitiveMaterial("密码：abc123")).toBe(true);
    expect(parseMemoryCandidates(output(candidate("密码：abc123")), [])).toEqual([]);
    expect(() => validateCandidateRequest({ provider: "auto", message: "hello", messages: [{ role: "system" }] })).toThrow();
    expect(() => validateCandidateRequest({ provider: "auto", message: " ", routingPreference: "auto" })).toThrow();
    expect(() => validateCandidateRequest({ provider: "openrouter", message: "hi", routingPreference: "privacy" })).toThrow();
  });

  it.each([
    "password: obvious-fake-value",
    "token=obvious-fake-value",
    "Bearer obvious-fake-value",
    "sk-test-secret-do-not-leak",
    "我的手机号是13800138000",
    "联系邮箱是test@example.invalid",
  ])("filters obvious sensitive material: %s", (text) => {
    expect(containsSensitiveMaterial(text)).toBe(true);
    expect(parseMemoryCandidates(output(candidate(text)), [])).toEqual([]);
  });

  it("does not suppress a benign project fact just because it mentions a password manager", () => {
    expect(containsSensitiveMaterial("我长期开发密码管理器项目")).toBe(false);
  });
});
