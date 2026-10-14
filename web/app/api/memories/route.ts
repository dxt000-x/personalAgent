import { MemoryApiError, memoryDatabaseError, memoryErrorResponse } from "@/lib/memories/errors";
import { memorySelect, privateJson, requireMemoryContext, assertSameOrigin } from "@/lib/memories/server";
import { readMemoryJson, validateCreateMemory } from "@/lib/memories/validation";
import { normalizeMemoryContent } from "@/lib/memories/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxMemoriesPerUser = 200;

export async function GET(): Promise<Response> {
  try {
    const { supabase, userId } = await requireMemoryContext();
    const { data, error } = await supabase
      .from("memories")
      .select(memorySelect)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw memoryDatabaseError(error);
    return privateJson({ memories: data ?? [] });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase, userId } = await requireMemoryContext();
    assertSameOrigin(request);
    const input = validateCreateMemory(await readMemoryJson(request));
    const { count, error: countError } = await supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw memoryDatabaseError(countError);
    if (count === null || !Number.isInteger(count) || count < 0) {
      throw new MemoryApiError("MEMORY_SERVICE_ERROR");
    }
    if (count >= maxMemoriesPerUser) throw new MemoryApiError("MEMORY_LIMIT_REACHED");
    const { data: existing, error: lookupError } = await supabase
      .from("memories")
      .select("content")
      .eq("user_id", userId)
      .limit(maxMemoriesPerUser);
    if (lookupError) throw memoryDatabaseError(lookupError);
    if (!Array.isArray(existing)) throw new MemoryApiError("MEMORY_SERVICE_ERROR");
    const normalized = normalizeMemoryContent(input.content);
    if (existing.some((row) => typeof row.content === "string" && normalizeMemoryContent(row.content) === normalized)) {
      throw new MemoryApiError("MEMORY_DUPLICATE");
    }
    const { data, error } = await supabase
      .from("memories")
      .insert({ user_id: userId, ...input })
      .select(memorySelect)
      .single();
    if (error) throw memoryDatabaseError(error);
    return privateJson({ memory: data }, 201);
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
