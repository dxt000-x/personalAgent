import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

export async function updateSession(request: NextRequest) {
  const config = getSupabaseConfig();
  const isAuthPage = ["/login", "/signup"].includes(request.nextUrl.pathname);
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirected = NextResponse.redirect(url);
    response.cookies
      .getAll()
      .forEach((cookie) => redirected.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirected.headers.set(header, value);
    }
    return redirected;
  }

  if (!config) return isAuthPage ? response : redirectTo("/login");

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });

  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && !!data?.claims.sub;
  } catch {
    // Provider failures never grant access or crash the public auth pages.
  }

  if (!authenticated && !isAuthPage) return redirectTo("/login");
  if (authenticated && isAuthPage) return redirectTo("/");
  return response;
}
