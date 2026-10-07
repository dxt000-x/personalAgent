import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AIGatewayError } from "./errors";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function aiJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: responseHeaders });
}

export function aiErrorResponse(error: unknown): Response {
  const safeError = error instanceof AIGatewayError
    ? error
    : new AIGatewayError("PROVIDER_ERROR");
  return aiJson({ error: { code: safeError.code, message: safeError.message } }, safeError.status);
}

export async function requireUserId(): Promise<string> {
  try {
    const supabase = await createClient();
    if (supabase) {
      const { data, error } = await supabase.auth.getClaims();
      if (!error && typeof data?.claims.sub === "string" && data.claims.sub) {
        return data.claims.sub;
      }
    }
  } catch {
    // Do not expose auth SDK errors or session details through the AI API.
  }
  throw new AIGatewayError("AUTH_REQUIRED");
}
