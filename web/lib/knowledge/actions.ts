import "server-only";
import type { KnowledgeDocument } from "./types";

// Mirrors claim_knowledge_document's strict updated_at < now() - 10 minutes.
// This is a server-clock UI hint; the database claim still checks ownership,
// Storage presence, generation and rate limits atomically on each request.
const PROCESSING_RECOVERY_MS = 10 * 60 * 1000;
export function withKnowledgeActions(document: KnowledgeDocument, now = Date.now()): KnowledgeDocument {
  const updatedAt = Date.parse(document.updated_at);
  const processing_action = document.status === "failed" && document.failure_kind === "temporary"
    ? "retry" as const
    : document.status === "processing" && Number.isFinite(updatedAt)
      && updatedAt < now - PROCESSING_RECOVERY_MS ? "recover" as const : null;
  return { ...document, processing_action };
}
