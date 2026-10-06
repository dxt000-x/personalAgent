import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = path === "/login" ? "?error=confirmation" : "";
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // This endpoint handles signup email confirmation only, not recovery or OAuth.
  if (tokenHash && type === "email") {
    try {
      const supabase = await createClient();
      if (supabase) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        // The SSR client writes the verified session through the cookies adapter.
        if (!error && data.session) return redirectTo("/");
      }
    } catch {
      // Invalid tokens, missing configuration and service failures do not grant access.
    }
  }

  return redirectTo("/login");
}
