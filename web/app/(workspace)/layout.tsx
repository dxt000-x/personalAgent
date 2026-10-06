import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  let email: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims.sub) {
      email =
        typeof data.claims.email === "string"
          ? data.claims.email
          : "已登录用户";
    }
  } catch {
    // Fail closed if the identity cannot be verified; public auth pages stay available.
  }
  if (!email) redirect("/login");

  return (
    <div className="min-h-screen lg:flex">
      <AppSidebar userEmail={email} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-6 py-4 text-xs text-slate-400 lg:px-10">
          <span>个人工作空间 / Personal workspace</span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
            UI Demo · 任务和知识内容均为演示数据
          </span>
        </div>
        <main className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
