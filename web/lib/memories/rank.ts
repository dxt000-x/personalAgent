import type { MemoryContextItem } from "./context-format";

export type RankableMemory = MemoryContextItem & {
  id: string;
  created_at: string;
  updated_at: string;
};

const maxTerms = 16;
const categoryHints: Partial<Record<RankableMemory["category"], RegExp>> = {
  preference: /偏好|喜欢|倾向|prefer|preference|favorite/u,
  profile: /姓名|名字|住在|个人资料|profile|name|live/u,
  goal: /目标|计划|打算|goal|plan/u,
  work: /工作|项目|职业|公司|work|project|job/u,
  study: /学习|课程|考试|学校|study|course|exam/u,
  habit: /习惯|日常|每天|经常|habit|routine|daily/u,
};

function searchTerms(message: string): string[] {
  const terms = new Set<string>();
  const normalized = message.normalize("NFKC").toLocaleLowerCase();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      if (word.length <= 8 && word.length >= 2) terms.add(word);
      for (let index = 0; index < word.length - 1 && terms.size < maxTerms; index++) {
        terms.add(word.slice(index, index + 2));
      }
    } else if (word.length >= 2) {
      terms.add(word);
    }
    if (terms.size >= maxTerms) break;
  }
  return [...terms];
}

function timeScore(memory: RankableMemory, now: number): number {
  const lastChanged = Math.max(Date.parse(memory.created_at), Date.parse(memory.updated_at));
  if (!Number.isFinite(lastChanged)) return 0;
  const ageDays = Math.max(0, now - lastChanged) / 86_400_000;
  if (ageDays <= 7) return 12;
  if (ageDays <= 30) return 9;
  if (ageDays <= 90) return 6;
  if (ageDays <= 365) return 3;
  return 0;
}

/** Pure, deterministic ranking; no database reads and no model calls. */
export function rankMemories(memories: RankableMemory[], latestUserMessage: string, now: number): RankableMemory[] {
  const normalizedQuery = latestUserMessage.normalize("NFKC").toLocaleLowerCase().trim();
  const terms = searchTerms(latestUserMessage);
  const selectedCategories = new Set(Object.entries(categoryHints)
    .filter(([, pattern]) => pattern.test(normalizedQuery))
    .map(([category]) => category));
  const scored = memories.map((memory) => {
    const content = memory.content.normalize("NFKC").toLocaleLowerCase();
    const matches = terms.reduce((count, term) => count + Number(content.includes(term)), 0);
    const exactMatch = normalizedQuery.length >= 2 && normalizedQuery.length <= 32
      && content.includes(normalizedQuery);
    const keyword = exactMatch ? 40 : matches ? Math.min(40, 24 + (matches - 1) * 8) : 0;
    return {
      memory,
      score: (memory.importance - 1) * 10 + keyword
        + (selectedCategories.has(memory.category) ? 8 : 0) + timeScore(memory, now),
    };
  });
  scored.sort((a, b) => b.score - a.score
    || b.memory.importance - a.memory.importance
    || Date.parse(b.memory.updated_at) - Date.parse(a.memory.updated_at)
    || Date.parse(b.memory.created_at) - Date.parse(a.memory.created_at)
    || (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0));
  return scored.map(({ memory }) => memory);
}
