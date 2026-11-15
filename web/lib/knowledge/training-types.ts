import type { KnowledgeDomain } from "./classification-types";
export type TrainingPoint = { id: string; term: string; topic: string; quote: string; chunkIndex: number; start: number; end: number };
export type TrainingQuestion = { id: string; pointId: string; kind: "choice" | "boolean" | "short"; excerpt: string; options: { id: string; term: string }[]; answer: string; explanation: string };
export type TrainingPack = { version: 1; id: string; ownerId: string; documentId: string; fileName: string; generation: number; domain: KnowledgeDomain;
  topics: string[]; points: TrainingPoint[]; questions: TrainingQuestion[]; engine: "rules" | "ollama"; aiFallback: boolean };
export type TrainingCatalogItem = { id: string; fileName: string; domain: KnowledgeDomain; topics: string[]; unavailable: boolean };
export type TrainingAttempt = { answer: string; correct: boolean | null; selfAssessment?: boolean };
export type TrainingMode = "learn" | "cards" | "test" | "wrong" | "random" | "category";
export function gradeTrainingAnswer(question: TrainingQuestion, answer: string): boolean | null {
  if (question.kind === "short") return null;
  if (question.kind === "choice" && !question.options.some(o => o.id === answer)) return false;
  return answer === question.answer;
}
export function trainingStats(pack: TrainingPack, attempts: Record<string, TrainingAttempt>, learned: string[]) {
  const ids = new Set(pack.questions.map(q => q.id));
  const rows = Object.entries(attempts).filter(([id]) => ids.has(id)).map(([, a]) => a);
  const automatic = rows.filter(a => a.correct !== null), wrong = rows.filter(a => a.correct === false || a.selfAssessment === false);
  return { learned: pack.points.filter(p => learned.includes(p.id)).length, answered: rows.length, total: pack.questions.length,
    correct: automatic.filter(a => a.correct).length, graded: automatic.length, wrong: wrong.length,
    weakPointIds: [...new Set(pack.questions.filter(q => attempts[q.id]?.correct === false || attempts[q.id]?.selfAssessment === false).map(q => q.pointId))] };
}
export function trainingQuestions(pack: TrainingPack, mode: TrainingMode, topic: string, attempts: Record<string, TrainingAttempt>, random = Math.random) {
  const pointIds = new Set(pack.points.filter(p => !topic || p.topic === topic).map(p => p.id));
  const rows = pack.questions.filter(q => pointIds.has(q.pointId) && (mode !== "wrong" || attempts[q.id]?.correct === false || attempts[q.id]?.selfAssessment === false));
  if (mode === "random") for (let i = rows.length - 1; i > 0; i--) { const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1)))); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows;
}

export function isTrainingPack(value: unknown, ownerId: string): value is TrainingPack {
  try {
  if (!value || typeof value !== "object") return false;
  const p = value as TrainingPack;
  return p.version === 1 && p.ownerId === ownerId && typeof p.id === "string" && /^[a-f0-9]{64}$/u.test(p.id)
    && typeof p.documentId === "string" && /^[a-f0-9-]{36}$/iu.test(p.documentId) && typeof p.fileName === "string" && p.fileName.length <= 180
    && Number.isSafeInteger(p.generation) && p.generation >= 0 && ["computing","mathematics","science","business","humanities","languages","general"].includes(p.domain)
    && ["rules","ollama"].includes(p.engine) && typeof p.aiFallback === "boolean" && Array.isArray(p.topics) && p.topics.length <= 16 && p.topics.every(t => typeof t === "string" && t.length <= 240)
    && Array.isArray(p.points) && p.points.length <= 16 && new Set(p.points.map(c => c.id)).size === p.points.length && p.points.every(c => typeof c.id === "string" && /^[a-f0-9]{24}$/u.test(c.id)
      && typeof c.term === "string" && c.term.length <= 240 && typeof c.topic === "string" && typeof c.quote === "string" && c.quote.length <= 500 && Number.isSafeInteger(c.chunkIndex) && c.chunkIndex >= 0 && c.chunkIndex < 200
      && Number.isSafeInteger(c.start) && c.start >= 0 && Number.isSafeInteger(c.end) && c.end - c.start === c.quote.length && c.quote.includes(c.term))
    && Array.isArray(p.questions) && p.questions.length === p.points.length * 3 && new Set(p.questions.map(q => q.id)).size === p.questions.length
    && p.questions.every(q => p.points.some(c => c.id === q.pointId && q.explanation === c.quote) && q.id === `${q.pointId}:${q.kind}` && ["choice","boolean","short"].includes(q.kind)
      && typeof q.excerpt === "string" && q.excerpt.length <= 600 && typeof q.answer === "string" && q.answer.length <= 500 && Array.isArray(q.options) && q.options.length <= 4
      && q.options.every(o => typeof o.id === "string" && typeof o.term === "string" && (o.id === "none" && o.term === "" || p.points.some(c => c.id === o.id && c.term === o.term))) && (q.kind !== "choice" || q.answer === q.pointId && q.options.length >= 2 && q.options.some(o => o.id === q.answer))
      && (q.kind !== "boolean" || ["true","false"].includes(q.answer) && q.options.length === 0) && (q.kind !== "short" || q.options.length === 0 && q.answer === p.points.find(c => c.id === q.pointId)?.quote)) ;
  } catch { return false; }
}
