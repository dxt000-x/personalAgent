import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MemoryApiError } from "./errors";

export const memorySelect =
  "id,user_id,content,category,importance,source,created_at,updated_at";

export async function requireMemoryContext() {
  const supabase = await createClient();
  if (!supabase) throw new MemoryApiError("AUTH_REQUIRED");

  try {
    const { data, error } = await supabase.auth.getClaims();
    const userId = !error && typeof data?.claims.sub === "string"
      ? data.claims.sub
      : "";
    if (!userId) throw new MemoryApiError("AUTH_REQUIRED");
    return { supabase, userId };
  } catch (error) {
    if (error instanceof MemoryApiError) throw error;
    throw new MemoryApiError("AUTH_REQUIRED");
  }
}

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new MemoryApiError("INVALID_REQUEST");
  }
}
