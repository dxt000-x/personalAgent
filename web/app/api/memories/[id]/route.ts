import { MemoryApiError, memoryDatabaseError, memoryErrorResponse } from "@/lib/memories/errors";
import { assertSameOrigin, memorySelect, privateJson, requireMemoryContext } from "@/lib/memories/server";
import { readMemoryJson, validateMemoryId, validateUpdateMemory } from "@/lib/memories/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { supabase, userId } = await requireMemoryContext();
    const id = validateMemoryId((await context.params).id);
    const { data, error } = await supabase
      .from("memories")
      .select(memorySelect)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw memoryDatabaseError(error);
    if (!data) throw new MemoryApiError("NOT_FOUND");
    return privateJson({ memory: data });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { supabase, userId } = await requireMemoryContext();
    assertSameOrigin(request);
    const id = validateMemoryId((await context.params).id);
    const input = validateUpdateMemory(await readMemoryJson(request));
    const { data, error } = await supabase
      .from("memories")
      .update(input)
      .eq("id", id)
      .eq("user_id", userId)
      .select(memorySelect)
      .maybeSingle();
    if (error) throw memoryDatabaseError(error);
    if (!data) throw new MemoryApiError("NOT_FOUND");
    return privateJson({ memory: data });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { supabase, userId } = await requireMemoryContext();
    assertSameOrigin(request);
    const id = validateMemoryId((await context.params).id);
    const { data, error } = await supabase
      .from("memories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) throw memoryDatabaseError(error);
    if (!data) throw new MemoryApiError("NOT_FOUND");
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
