import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    try {
      const supabase = await createClient();
      if (supabase) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) return NextResponse.redirect(new URL("/", request.url));
      }
    } catch {
      // Expired codes and provider outages return to the public login page.
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", request.url),
  );
}
