import "server-only";
import { createClient } from "@/lib/supabase/server";
import { KnowledgeError } from "./errors";
import { DOCUMENT_PAGE_SIZE, MAX_FILE_BYTES, KNOWLEDGE_BUCKET, type KnowledgeDocument, type UploadInput } from "./types";
import type { KnowledgeRepository } from "./service";

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const documentColumns = "id,user_id,file_name,file_type,byte_size,storage_path,status,chunk_count,created_at,updated_at";

export async function requireKnowledgeContext(): Promise<{ userId: string; repository: KnowledgeRepository }> {
  const supabase = await createClient();
  if (!supabase) throw new KnowledgeError("AUTH_REQUIRED");
  try {
    const { data, error } = await supabase.auth.getClaims();
    const userId = !error && typeof data?.claims.sub === "string" ? data.claims.sub : "";
    if (!userId) throw new KnowledgeError("AUTH_REQUIRED");
    return { userId, repository: new SupabaseKnowledgeRepository(supabase) };
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

class SupabaseKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly client: Client) {}

  async list(userId: string, offset: number): Promise<KnowledgeDocument[]> {
    const { data, error } = await this.client.from("knowledge_documents")
      .select(documentColumns).eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + DOCUMENT_PAGE_SIZE - 1);
    if (error) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return (data ?? []) as KnowledgeDocument[];
  }

  async create(userId: string, input: UploadInput): Promise<KnowledgeDocument> {
    const { data, error } = await this.client.from("knowledge_documents")
      .insert({ id: crypto.randomUUID(), user_id: userId, file_name: input.fileName,
        file_type: input.fileType, byte_size: input.byteSize })
      .select(documentColumns).single();
    if (error || !data) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data as KnowledgeDocument;
  }

  async find(userId: string, documentId: string): Promise<KnowledgeDocument | null> {
    const { data, error } = await this.client.from("knowledge_documents")
      .select(documentColumns).eq("id", documentId).eq("user_id", userId).maybeSingle();
    if (error) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data as KnowledgeDocument | null;
  }

  private async transition(name: string, documentId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc(name, { p_document_id: documentId });
    if (error || typeof data !== "boolean") throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data;
  }

  claim(documentId: string) { return this.transition("claim_knowledge_document", documentId); }
  fail(documentId: string) { return this.transition("fail_knowledge_document", documentId); }
  markDeleting(documentId: string) { return this.transition("mark_knowledge_deleting", documentId); }
  finishDeleting(documentId: string) { return this.transition("finish_knowledge_deletion", documentId); }

  async complete(documentId: string, chunks: string[]): Promise<boolean> {
    const { data, error } = await this.client.rpc("complete_knowledge_document", {
      p_document_id: documentId, p_chunks: chunks,
    });
    if (error || typeof data !== "boolean") throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data;
  }

  async read(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(KNOWLEDGE_BUCKET).download(path);
    if (error || !data) throw new KnowledgeError("STORAGE_UNAVAILABLE");
    if (data.size > MAX_FILE_BYTES) throw new KnowledgeError("FILE_TOO_LARGE");
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(KNOWLEDGE_BUCKET).remove([path]);
    if (error) throw new KnowledgeError("STORAGE_UNAVAILABLE");
  }
}
