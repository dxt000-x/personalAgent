import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  function redirectTo(path: string) {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    try {
      const supabase = await createClient();
      if (supabase) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) return redirectTo("/");
      }
    } catch {
      // Expired codes and provider outages return to the public login page.
    }
  }
  return redirectTo("/login?error=confirmation");
}
