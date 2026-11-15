import { createHash } from "node:crypto";
import type { KnowledgeDocument } from "./types";

import { CLASSIFIER_VERSION, domains, difficulties, documentTypes, type KnowledgeDomain, type Evidence, type KnowledgeClassification, type ManualClassificationPatch } from "./classification-types";
export * from "./classification-types";

export type ClassificationCode = "CLASSIFICATION_STORAGE_REQUIRED" | "CLASSIFICATION_UNAVAILABLE" | "CLASSIFICATION_CONFLICT" | "CLASSIFICATION_INVALID" | "CLASSIFICATION_SOURCE_UNAVAILABLE" | "CLASSIFICATION_CONFIRMED";
export class ClassificationError extends Error {
  constructor(public readonly code: ClassificationCode) { super(code); }
}
const digest = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const suspicious = /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|reveal\s+(?:secrets|tokens)|忽略.{0,12}(?:指令|规则)|泄露.{0,8}(?:密码|密钥)/iu;
const vocabulary: Record<Exclude<KnowledgeDomain, "general">, readonly string[]> = {
  computing: ["算法", "数据库", "程序设计", "机器学习", "神经网络", "网络安全", "algorithm", "database", "programming", "typescript", "javascript", "neural network", "machine learning", "computer science"],
  mathematics: ["微积分", "线性代数", "概率", "定理", "矩阵", "方程", "calculus", "algebra", "probability", "theorem", "matrix", "equation"],
  science: ["物理", "化学", "生物", "分子", "细胞", "能量", "physics", "chemistry", "biology", "molecule", "cell", "energy"],
  business: ["市场营销", "会计", "财务", "项目管理", "商业", "管理学", "marketing", "accounting", "finance", "project management", "business"],
  humanities: ["历史", "哲学", "文学", "社会学", "心理学", "history", "philosophy", "literature", "sociology", "psychology"],
  languages: ["语法", "词汇", "英语", "翻译", "语言学习", "grammar", "vocabulary", "translation", "language learning"],
};

export function sourceDigest(document: KnowledgeDocument, chunks: readonly string[]): string {
  return digest(JSON.stringify([CLASSIFIER_VERSION, document.user_id, document.id, document.processing_generation, chunks]));
}
function evidence(chunks: readonly string[], chunkIndex: number, start: number, end: number): Evidence {
  return { chunkIndex, start, end, quote: chunks[chunkIndex].slice(start, end) };
}
export function evidenceMatches(e: Evidence, chunks: readonly string[]): boolean {
  return !!e && Number.isSafeInteger(e.chunkIndex) && Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end)
    && e.start >= 0 && e.end > e.start && e.end - e.start <= 500 && typeof chunks[e.chunkIndex] === "string"
    && chunks[e.chunkIndex].slice(e.start, e.end) === e.quote && !suspicious.test(e.quote);
}

export function classifyDocument(document: KnowledgeDocument, chunks: readonly string[]): KnowledgeClassification {
  if (chunks.length > 200 || chunks.some((c) => typeof c !== "string") || chunks.reduce((n, c) => n + c.length, 0) > 220_000)
    throw new ClassificationError("CLASSIFICATION_SOURCE_UNAVAILABLE");
  const joined = chunks.join("\n"), unsafe = suspicious.test(joined);
  const matches: { domain: KnowledgeDomain; term: string; evidence: Evidence }[] = [];
  for (const [domain, terms] of Object.entries(vocabulary)) {
    for (const term of terms) {
      for (let ci = 0; ci < chunks.length; ci++) {
        const pattern = new RegExp(/[a-z]/iu.test(term) ? `(?<![a-z])${term}(?![a-z])` : term, "iu");
        const match = pattern.exec(chunks[ci]);
        if (!match || suspicious.test(chunks[ci].slice(Math.max(0, match.index - 100), match.index + match[0].length + 100))) continue;
        matches.push({ domain: domain as KnowledgeDomain, term: match[0], evidence: evidence(chunks, ci, match.index, match.index + match[0].length) });
        break;
      }
    }
  }
  const ranked = domains.filter((d) => d !== "general").map((domain) => ({ domain, count: matches.filter((m) => m.domain === domain).length }))
    .sort((a, b) => b.count - a.count || domains.indexOf(a.domain) - domains.indexOf(b.domain));
  const primary = ranked[0], multi = ranked.filter((d) => d.count > 0).length > 1;
  const confidence = unsafe ? 0.2 : primary.count ? Math.min(0.92, 0.4 + primary.count * 0.12) * (multi ? 0.65 : 1) : 0;
  const points = new Map<string, { term: string; evidence: Evidence }>();
  for (const item of matches) points.set(item.term.toLocaleLowerCase("en"), item);
  for (const [ci, chunk] of chunks.entries()) {
    for (const match of chunk.matchAll(/^\s*#{1,6}\s+([^\r\n]{2,60})/gmu)) {
      const term = match[1].trim(), start = match.index + match[0].indexOf(term);
      if (!suspicious.test(term)) points.set(term.toLocaleLowerCase("en"), { term, evidence: evidence(chunks, ci, start, start + term.length) });
    }
  }
  const concepts = [...points.values()].slice(0, 20).map((p) => ({ id: digest(JSON.stringify([p.term, p.evidence])).slice(0, 24), term: p.term,
    evidence: [p.evidence], learningObjectives: [] as string[], exercises: [] as string[] }));
  const summary: KnowledgeClassification["summary"] = [];
  for (const [ci, chunk] of chunks.entries()) {
    for (const match of chunk.matchAll(/[^\r\n。！？.!?]{12,240}[。！？.!?]?/gu)) {
      const text = match[0].trim(), start = match.index + match[0].indexOf(text);
      if (!text || suspicious.test(text) || summary.some((s) => s.text === text)) continue;
      summary.push({ text, evidence: evidence(chunks, ci, start, start + text.length) });
      if (summary.length === 3) break;
    }
    if (summary.length === 3) break;
  }
  const usable = joined.trim().length > 0;
  return { version: 1, algorithm: CLASSIFIER_VERSION, revision: 1,
    source: { generation: document.processing_generation, digest: sourceDigest(document, chunks), format: document.file_type },
    state: !usable ? "failed" : confidence < 0.65 || multi || unsafe ? "needs_review" : "pending",
    confidence, domain: primary.count ? primary.domain : "general",
    topics: [...new Map((multi ? ranked.filter((d) => d.count > 0).map((d) => matches.find((m) => m.domain === d.domain)!).concat(matches)
      : matches.filter((m) => m.domain === primary.domain)).map((m) => [m.term, m])).values()].slice(0, 6).map((m) => ({ label: m.term, evidence: [m.evidence] })),
    concepts, tags: concepts.slice(0, 12).map((p) => p.term), keywords: matches.slice(0, 20).map((m) => m.term), summary,
    documentType: /tutorial|教程|step\s+\d|步骤/iu.test(joined) ? "tutorial" : document.file_type === "md" ? "notes" : "reference",
    difficulty: /advanced|进阶|高级/iu.test(joined) ? "advanced" : /introduct|beginner|入门|基础/iu.test(joined) ? "introductory" : "unknown",
    reviewedByUser: false, manuallyEdited: false, untrustedInstructionsDetected: unsafe };
}

export function validateClassification(value: unknown, document: KnowledgeDocument, chunks?: readonly string[]): KnowledgeClassification {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 32_000)
    throw new ClassificationError("CLASSIFICATION_INVALID");
  const v = value as KnowledgeClassification;
  if (Object.keys(v).sort().join(",") !== "algorithm,concepts,confidence,difficulty,documentType,domain,keywords,manuallyEdited,reviewedByUser,revision,source,state,summary,tags,topics,untrustedInstructionsDetected,version"
    || !v.source || Object.keys(v.source).sort().join(",") !== "digest,format,generation") throw new ClassificationError("CLASSIFICATION_INVALID");
  if (v.version !== 1 || v.algorithm !== CLASSIFIER_VERSION || !Number.isSafeInteger(v.revision) || v.revision < 1
    || !["pending", "confirmed", "needs_review", "failed"].includes(v.state) || !domains.includes(v.domain)
    || typeof v.confidence !== "number" || !Number.isFinite(v.confidence) || v.confidence < 0 || v.confidence > 1
    || !v.source || v.source.generation !== document.processing_generation || v.source.format !== document.file_type
    || !/^[a-f0-9]{64}$/u.test(v.source.digest) || !documentTypes.includes(v.documentType) || !difficulties.includes(v.difficulty)
    || typeof v.reviewedByUser !== "boolean" || typeof v.manuallyEdited !== "boolean" || typeof v.untrustedInstructionsDetected !== "boolean"
    || v.state === "confirmed" && !v.reviewedByUser) throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const field of [v.tags, v.keywords]) if (!Array.isArray(field) || field.length > 20 || new Set(field).size !== field.length
    || field.some((s) => typeof s !== "string" || !s.trim() || s.length > 80 || /[\u0000-\u001f]/u.test(s))) throw new ClassificationError("CLASSIFICATION_INVALID");
  if (!Array.isArray(v.topics) || v.topics.length > 6 || !Array.isArray(v.concepts) || v.concepts.length > 20 || !Array.isArray(v.summary) || v.summary.length > 3)
    throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const topic of v.topics) if (typeof topic.label !== "string" || !topic.label.trim() || topic.label.length > 80 || !Array.isArray(topic.evidence)
    || topic.evidence.length > 4 || !topic.manual && topic.evidence.length < 1) throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const point of v.concepts) if (typeof point.term !== "string" || !point.term.trim() || point.term.length > 80
    || !/^[a-f0-9]{24}$/u.test(point.id) || !Array.isArray(point.evidence) || point.evidence.length < 1 || point.evidence.length > 4
    || !Array.isArray(point.learningObjectives) || point.learningObjectives.length || !Array.isArray(point.exercises) || point.exercises.length)
    throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const line of v.summary) if (typeof line.text !== "string" || !line.text.trim() || line.text.length > 500 || line.text !== line.evidence?.quote)
    throw new ClassificationError("CLASSIFICATION_INVALID");
  const refs = [...v.topics.flatMap((t) => t.evidence), ...v.concepts.flatMap((p) => p.evidence), ...v.summary.map((s) => s.evidence)];
  for (const ref of refs) if (!ref || !Number.isSafeInteger(ref.chunkIndex) || !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end)
    || ref.chunkIndex < 0 || ref.start < 0 || ref.end <= ref.start || ref.end - ref.start > 500 || typeof ref.quote !== "string"
    || ref.quote.length !== ref.end - ref.start || suspicious.test(ref.quote)) throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const point of v.concepts) if (!point.evidence.some((e) => e.quote === point.term)) throw new ClassificationError("CLASSIFICATION_INVALID");
  if (chunks && (v.source.digest !== sourceDigest(document, chunks) || refs.some((e) => !evidenceMatches(e, chunks))))
    throw new ClassificationError("CLASSIFICATION_SOURCE_UNAVAILABLE");
  return v;
}


export function applyManualClassification(previous: KnowledgeClassification, patch: ManualClassificationPatch, confirm: boolean): KnowledgeClassification {
  if (!patch || !domains.includes(patch.domain) || !documentTypes.includes(patch.documentType) || !difficulties.includes(patch.difficulty)
    || !Array.isArray(patch.topics) || patch.topics.length > 6 || !Array.isArray(patch.tags) || patch.tags.length > 20)
    throw new ClassificationError("CLASSIFICATION_INVALID");
  for (const text of [...patch.topics, ...patch.tags]) if (typeof text !== "string" || !text.trim() || text.length > 80 || /[\u0000-\u001f]/u.test(text))
    throw new ClassificationError("CLASSIFICATION_INVALID");
  return { ...previous, revision: previous.revision + 1, domain: patch.domain,
    topics: [...new Set(patch.topics.map((s) => s.trim()))].map((label) => ({ label, evidence: previous.topics.find((t) => t.label === label)?.evidence ?? [], manual: true })),
    tags: [...new Set(patch.tags.map((s) => s.trim()))], documentType: patch.documentType, difficulty: patch.difficulty,
    manuallyEdited: true, reviewedByUser: confirm, state: confirm ? "confirmed" : "pending" };
}
