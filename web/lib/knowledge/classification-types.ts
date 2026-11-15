export const CLASSIFIER_VERSION = "local-evidence-v1";
export const domains = ["computing", "mathematics", "science", "business", "humanities", "languages", "general"] as const;
export type KnowledgeDomain = typeof domains[number];
export const domainLabels: Record<KnowledgeDomain, string> = { computing: "计算机与技术", mathematics: "数学", science: "自然科学", business: "商业与管理", humanities: "人文与社会", languages: "语言学习", general: "未分类" };
export const difficulties = ["introductory", "intermediate", "advanced", "unknown"] as const;
export const documentTypes = ["notes", "tutorial", "reference", "article", "other"] as const;
export type ClassificationState = "pending" | "confirmed" | "needs_review" | "failed";
export type Evidence = { chunkIndex: number; start: number; end: number; quote: string };
export type KnowledgeClassification = {
  version: 1; algorithm: typeof CLASSIFIER_VERSION; revision: number;
  source: { generation: number; digest: string; format: "pdf" | "txt" | "md" };
  state: ClassificationState; confidence: number; domain: KnowledgeDomain;
  topics: { label: string; evidence: Evidence[]; manual?: boolean }[];
  concepts: { id: string; term: string; evidence: Evidence[]; learningObjectives: string[]; exercises: string[] }[];
  tags: string[]; keywords: string[]; summary: { text: string; evidence: Evidence }[];
  documentType: typeof documentTypes[number]; difficulty: typeof difficulties[number];
  reviewedByUser: boolean; manuallyEdited: boolean; untrustedInstructionsDetected: boolean;
};
export type ManualClassificationPatch = { domain: KnowledgeDomain; topics: string[]; tags: string[];
  documentType: KnowledgeClassification["documentType"]; difficulty: KnowledgeClassification["difficulty"] };

// Browser response guard only; authoritative evidence/ownership validation stays
// on the server. No crypto, model SDK or private connection code enters bundles.
export function isClassificationView(value: unknown): value is KnowledgeClassification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as KnowledgeClassification;
  return v.version === 1 && v.algorithm === CLASSIFIER_VERSION && Number.isSafeInteger(v.revision) && v.revision > 0
    && domains.includes(v.domain) && ["pending", "confirmed", "needs_review", "failed"].includes(v.state)
    && typeof v.confidence === "number" && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1
    && documentTypes.includes(v.documentType) && difficulties.includes(v.difficulty)
    && !!v.source && /^[a-f0-9]{64}$/u.test(v.source.digest) && Number.isSafeInteger(v.source.generation)
    && ["pdf", "txt", "md"].includes(v.source.format)
    && Array.isArray(v.tags) && v.tags.length <= 20 && v.tags.every((s) => typeof s === "string" && s.length <= 80)
    && Array.isArray(v.keywords) && v.keywords.length <= 20 && v.keywords.every((s) => typeof s === "string")
    && Array.isArray(v.topics) && v.topics.length <= 6 && v.topics.every((t) => typeof t.label === "string")
    && Array.isArray(v.concepts) && v.concepts.length <= 20 && v.concepts.every((p) => typeof p.id === "string" && typeof p.term === "string"
      && Array.isArray(p.evidence) && p.evidence.length > 0 && p.evidence.every((e) => typeof e.quote === "string" && Number.isSafeInteger(e.chunkIndex)))
    && Array.isArray(v.summary) && v.summary.length <= 3 && v.summary.every((s) => typeof s.text === "string" && !!s.evidence && Number.isSafeInteger(s.evidence.chunkIndex));
}
