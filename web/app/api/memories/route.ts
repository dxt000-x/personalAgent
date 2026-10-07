import { memoryDatabaseError, memoryErrorResponse } from "@/lib/memories/errors";
import { memorySelect, privateJson, requireMemoryContext, assertSameOrigin } from "@/lib/memories/server";
import { readMemoryJson, validateCreateMemory } from "@/lib/memories/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
