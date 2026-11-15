import { createHash } from "node:crypto";
import { classifyDocument, sourceDigest } from "./classification";
import { KnowledgeError } from "./errors";
import type { KnowledgeDocument } from "./types";
import type { TrainingPack, TrainingPoint, TrainingQuestion } from "./training-types";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const unsafe = /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|reveal\s+(?:secrets|tokens)|忽略.{0,12}(?:指令|规则)|泄露.{0,8}(?:密码|密钥)/iu;
export interface TrainingRepository {
  find(userId: string, id: string): Promise<KnowledgeDocument | null>;
  chunks(userId: string, id: string): Promise<string[]>;
}
export async function trainingSource(repository: TrainingRepository, userId: string, id: string) {
  const doc = await repository.find(userId, id);
  if (!doc || doc.id !== id || doc.user_id !== userId) throw new KnowledgeError("DOCUMENT_NOT_FOUND");
  if (doc.status !== "ready") throw new KnowledgeError("DOCUMENT_BUSY");
  const chunks = await repository.chunks(userId, id);
  if (!chunks.length || chunks.length !== doc.chunk_count || chunks.length > 200 || chunks.some(c => typeof c !== "string" || !c.trim() || c.length > 5000)) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  const current = await repository.find(userId, id);
  if (!current || current.user_id !== userId || current.status !== "ready" || current.processing_generation !== doc.processing_generation || current.chunk_count !== doc.chunk_count) throw new KnowledgeError("DOCUMENT_BUSY");
  return { doc, chunks };
}
export function buildTrainingPack(doc: KnowledgeDocument, chunks: string[]): TrainingPack {
  const classification = classifyDocument(doc, chunks), points: TrainingPoint[] = [];
  const add = (term: string, ci: number, start: number, end: number) => {
    const chunk = chunks[ci]; if (!chunk || start < 0 || end > chunk.length || end <= start || points.some(p => p.term.toLowerCase() === term.toLowerCase())) return;
    const left = Math.max(chunk.lastIndexOf("\n", start), chunk.lastIndexOf("。", start)) + 1;
    const from = Math.max(left, start - 100);
    const nextHeading = chunk.slice(end).search(/\n\s*#/u);
    const to = Math.min(chunk.length, Math.max(end, start + 160), nextHeading >= 0 ? end + nextHeading : chunk.length);
    const quote = chunk.slice(from, to);
    if (unsafe.test(quote) || !term.trim() || points.length >= 16) return;
    const headings = chunks.slice(0, ci + 1).flatMap((part, index) => [...part.matchAll(/^\s*#{1,6}\s+([^\r\n]{2,60})/gmu)].filter(m => index < ci || m.index <= start).map(m => m[1].trim())).filter(h => !unsafe.test(h));
    const topic = headings.at(-1) ?? classification.topics.find(t => t.evidence.some(e => e.chunkIndex === ci))?.label ?? classification.topics[0]?.label ?? "";
    points.push({ id: hash(JSON.stringify([doc.id, doc.processing_generation, ci, from, to, term])).slice(0, 24), term, topic, quote, chunkIndex: ci, start: from, end: to });
  };
  for (const c of classification.concepts) { const e = c.evidence[0]; if (e && chunks[e.chunkIndex]?.slice(e.start, e.end) === e.quote) add(c.term, e.chunkIndex, e.start, e.end); }
  if (!points.length) for (const [ci, chunk] of chunks.entries()) for (const m of chunk.matchAll(/[^\r\n。！？.!?]{12,200}[。！？.!?]?/gu)) {
    const text = m[0].trim(); if (text && !unsafe.test(text)) { const start = m.index + m[0].indexOf(text); add(text.slice(0, 24), ci, start, start + text.length); }
    if (points.length >= 8) break;
  }
  const questions: TrainingQuestion[] = [];
  for (const [i, point] of points.entries()) {
    const options = [point, ...points.filter(p => p.id !== point.id).slice(0, 3)].map(p => ({ id: p.id, term: p.term }));
    if (options.length === 1) options.push({ id: "none", term: "" });
    const shift = i % options.length; options.push(...options.splice(0, shift));
    questions.push({ id: point.id + ":choice", pointId: point.id, kind: "choice", excerpt: point.quote.split(point.term).join("____"), options, answer: point.id, explanation: point.quote });
    // Explicit verbatim comparison, not an invented factual assertion.
    const excerpt = i % 2 ? point.quote + "〔?〕" : point.quote;
    questions.push({ id: point.id + ":boolean", pointId: point.id, kind: "boolean", excerpt, options: [], answer: String(chunks.some(c => c.includes(excerpt))), explanation: point.quote });
    questions.push({ id: point.id + ":short", pointId: point.id, kind: "short", excerpt: point.term, options: [], answer: point.quote, explanation: point.quote });
  }
  return { version: 1, id: sourceDigest(doc, chunks), ownerId: doc.user_id, documentId: doc.id, fileName: doc.file_name, generation: doc.processing_generation,
    domain: classification.domain, topics: [...new Set(points.map(p => p.topic).filter(Boolean))], points, questions, engine: "rules", aiFallback: false };
}
export async function generateTraining(repository: TrainingRepository, userId: string, id: string, prioritize?: (points: TrainingPoint[]) => Promise<unknown>) {
  const { doc, chunks } = await trainingSource(repository, userId, id);
  const pack = buildTrainingPack(doc, chunks);
  if (prioritize && pack.points.length) {
    try {
      const ids = await prioritize(pack.points);
      if (!Array.isArray(ids) || !ids.length || ids.length > pack.points.length || ids.some(id => typeof id !== "string" || !pack.points.some(p => p.id === id)) || new Set(ids).size !== ids.length) throw new Error("INVALID_SELECTION");
      pack.points.sort((a, b) => { const rank = (id: string) => ids.includes(id) ? ids.indexOf(id) : pack.points.length; return rank(a.id) - rank(b.id); });
      const order = new Map(pack.points.map((p, i) => [p.id, i])); pack.questions.sort((a, b) => order.get(a.pointId)! - order.get(b.pointId)!); pack.engine = "ollama";
    } catch { pack.aiFallback = true; }
  }
  return pack;
}
