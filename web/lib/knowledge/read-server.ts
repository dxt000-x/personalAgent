// Shared authenticated read boundary. No Knowledge Writer, classification storage or private RPC imports.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { KnowledgeError } from "./errors";
import { DOCUMENT_PAGE_SIZE, type KnowledgeDocument } from "./types";
type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
export const documentColumns = "id,user_id,file_name,file_type,byte_size,storage_path,status,failure_kind,processing_generation,chunk_count,created_at,updated_at";

export async function requireKnowledgeSearchContext(): Promise<{ userId: string; client: Client }> {
  const supabase = await createClient();
  if (!supabase) throw new KnowledgeError("AUTH_REQUIRED");
  try {
    const { data, error } = await supabase.auth.getClaims();
    const userId = !error && typeof data?.claims.sub === "string" ? data.claims.sub : "";
    if (!userId) throw new KnowledgeError("AUTH_REQUIRED");
    return { userId, client: supabase };
  } catch {
    throw new KnowledgeError("AUTH_REQUIRED");
  }
}

export function assertKnowledgeOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new KnowledgeError("INVALID_REQUEST");
}

export function privateKnowledgeJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export class SupabaseKnowledgeReadRepository {
  constructor(protected readonly client: Client) {}
  async list(userId: string, offset: number): Promise<KnowledgeDocument[]> {
    const { data, error } = await this.client.from("knowledge_documents")
      .select(documentColumns).eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + DOCUMENT_PAGE_SIZE - 1);
    if (error) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return (data ?? []) as KnowledgeDocument[];
  }

  async find(userId: string, documentId: string): Promise<KnowledgeDocument | null> {
    const { data, error } = await this.client.from("knowledge_documents")
      .select(documentColumns).eq("id", documentId).eq("user_id", userId).maybeSingle();
    if (error) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data as KnowledgeDocument | null;
  }

}
