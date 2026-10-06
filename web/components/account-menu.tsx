"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { unconfiguredMessage } from "@/lib/supabase/config";

export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  async function logout() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      if (!supabase) {
        setError(unconfiguredMessage);
        return;
      }
      const { error: authError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (authError) {
        setError("退出失败，请检查网络后重试。");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("退出失败，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">
          {email.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={email}>
            {email}
          </p>
          <p className="text-xs text-slate-400">已登录 · Supabase Auth</p>
        </div>
      </div>
      <button
        onClick={logout}
        disabled={loading}
        className="button-secondary mt-3 w-full"
      >
        {loading ? "退出中…" : "Logout · 退出登录"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
