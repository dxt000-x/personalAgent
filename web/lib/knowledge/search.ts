import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { KnowledgeError } from "./errors";
import { validateDocumentId } from "./validation";
import { MAX_SEARCH_QUERY_CHARS, MAX_SEARCH_RESULTS, MAX_SEARCH_SNIPPET_CHARS,
  MAX_SEARCH_TOTAL_CHARS, SEARCH_TIMEOUT_MS, type KnowledgeSearchResult } from "./search-types";

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type KnowledgeSearchInput = { query: string; documentId?: string };

export function validateSearchInput(value: unknown): KnowledgeSearchInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeError("INVALID_REQUEST");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "query" && key !== "documentId") ||
      typeof input.query !== "string") throw new KnowledgeError("INVALID_REQUEST");
  const query = input.query.trim();
  // Restrict the MVP to literal words/numbers. PostgREST ILIKE treats %, _, and * as wildcards;
  // rejecting them (and escapes) prevents a user query from widening the search.
  if (!query || query.length > MAX_SEARCH_QUERY_CHARS || !/^[\p{L}\p{M}\p{N} ]+$/u.test(query)) {
    throw new KnowledgeError("INVALID_REQUEST");
  }
  if ("documentId" in input) {
    if (typeof input.documentId !== "string") throw new KnowledgeError("INVALID_REQUEST");
    return { query, documentId: validateDocumentId(input.documentId).toLowerCase() };
  }
  return { query };
}

function snippetFor(content: string, query: string): string {
  const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, (index < 0 ? 0 : index) - 120);
  const prefix = start > 0 ? "…" : "";
  const end = Math.min(content.length, start + MAX_SEARCH_SNIPPET_CHARS - prefix.length);
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end)}${suffix}`.slice(0, MAX_SEARCH_SNIPPET_CHARS);
}

export async function searchKnowledgeChunks(client: Client, userId: string, query: string,
  documentId?: string, signal?: AbortSignal): Promise<KnowledgeSearchResult[]> {
  try {
    let builder = client.from("knowledge_chunks")
      .select("document_id,chunk_index,content,knowledge_documents!inner(file_name,status,user_id)")
      .eq("user_id", userId)
      .eq("knowledge_documents.user_id", userId)
      .eq("knowledge_documents.status", "ready")
      .ilike("content", `%${query}%`);
    if (documentId) builder = builder.eq("document_id", documentId);
    const { data, error } = await builder
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(MAX_SEARCH_RESULTS)
      .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS));
    if (error || !Array.isArray(data) || data.length > MAX_SEARCH_RESULTS) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    let total = 0;
    return data.map((value) => {
      const row = value as { document_id?: unknown; chunk_index?: unknown; content?: unknown;
        knowledge_documents?: { file_name?: unknown; status?: unknown; user_id?: unknown } | null };
      const document = row.knowledge_documents;
      if (typeof row.document_id !== "string" || (documentId && row.document_id !== documentId) ||
          !Number.isInteger(row.chunk_index) ||
          typeof row.content !== "string" || row.content.length > 1200 ||
          !document || typeof document.file_name !== "string" || document.file_name.length > 180 ||
          document.status !== "ready" || document.user_id !== userId) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
      const snippet = snippetFor(row.content, query);
      total += snippet.length;
      if (total > MAX_SEARCH_TOTAL_CHARS) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
      return { documentId: row.document_id, fileName: document.file_name,
        chunkIndex: row.chunk_index as number, snippet };
    });
  } catch {
    // Supabase and timeout exceptions may contain SQL, query data, or internal headers.
    throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  }
}
