import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/server";
import { I18nProvider, UiText } from "@/components/i18n-provider";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  let email: string | null = null;
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims.sub) {
      userId = typeof data.claims.sub === "string" ? data.claims.sub : null;
      email =
        typeof data.claims.email === "string"
          ? data.claims.email
          : "已登录用户";
    }
  } catch {
    // Fail closed if the identity cannot be verified; public auth pages stay available.
  }
  if (!email || !userId) redirect("/login");

  return (
    <I18nProvider key={userId} userId={userId}><div className="min-h-screen lg:flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3"><UiText source="跳到主要内容" /></a>
      <AppSidebar userEmail={email} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4 text-xs text-slate-400 lg:px-10">
          <span><UiText source="个人工作空间 / Personal workspace" /></span>
          <span className="hidden rounded-full bg-amber-50 md:inline-block px-3 py-1 text-amber-800">
            <UiText source="对话 · 个人记忆 · 文档知识库" />
          </span>
        </div>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div></I18nProvider>
  );
}
