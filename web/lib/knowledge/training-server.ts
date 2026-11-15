import "server-only";
import { SupabaseKnowledgeReadRepository } from "./read-server";
import type { createClient } from "@/lib/supabase/server";
import { KnowledgeError } from "./errors";
import { generateTraining, type TrainingRepository } from "./training";
import type { TrainingCatalogItem } from "./training-types";
type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
export class SupabaseTrainingRepository implements TrainingRepository {
  constructor(private readonly client: Client) {}
  find(userId: string, id: string) { return new SupabaseKnowledgeReadRepository(this.client).find(userId, id); }
  async chunks(userId: string, id: string): Promise<string[]> {
    const { data, error } = await this.client.from("knowledge_chunks").select("document_id,user_id,chunk_index,content")
      .eq("document_id", id).eq("user_id", userId).order("chunk_index", { ascending: true }).limit(200);
    if (error || !data || data.some((row, i) => row.user_id !== userId || row.document_id !== id || row.chunk_index !== i || typeof row.content !== "string")) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
    return data.map(row => row.content as string);
  }
}
export async function trainingCatalog(client: Client, userId: string, offset: number) {
  const documents = await new SupabaseKnowledgeReadRepository(client).list(userId, offset);
  if (documents.some(d => d.user_id !== userId)) throw new KnowledgeError("KNOWLEDGE_UNAVAILABLE");
  const items: TrainingCatalogItem[] = [];
  const repository = new SupabaseTrainingRepository(client);
  for (const d of documents.slice(0, 10).filter(d => d.status === "ready")) {
    try { const pack = await generateTraining(repository, userId, d.id); items.push({ id: d.id, fileName: d.file_name, domain: pack.domain, topics: pack.topics, unavailable: false }); }
    catch { items.push({ id: d.id, fileName: d.file_name, domain: "general", topics: [], unavailable: true }); }
  }
  return { ownerId: userId, items, nextOffset: documents.length > 10 ? offset + 10 : null };
}
