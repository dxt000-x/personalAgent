"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { unconfiguredMessage } from "@/lib/supabase/config";

export function AuthForm({
  mode,
  configured,
  confirmationFailed = false,
}: {
  mode: "login" | "signup";
  configured: boolean;
  confirmationFailed?: boolean;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    confirmationFailed
      ? "确认链接无效或已过期，请尝试登录，或重新注册后使用最新邮件链接。"
      : "",
  );
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (isSignup && password !== form.get("confirmPassword")) {
      setError("两次输入的密码不一致。");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      if (!supabase) {
        setError(unconfiguredMessage);
        return;
      }
      const { data, error: authError } = isSignup
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        const messages: Record<string, string> = {
          invalid_credentials: "邮箱或密码不正确，请重试。",
          email_not_confirmed: "请先通过邮件确认邮箱，再登录。",
          user_already_exists: "该邮箱已注册，请前往登录。",
          weak_password: "密码不符合安全要求，请使用更强的密码。",
          over_request_rate_limit: "请求过于频繁，请稍后重试。",
          over_email_send_rate_limit: "邮件发送过于频繁，请稍后重试。",
          signup_disabled: "当前项目尚未开放注册，请联系项目管理员。",
        };
        setError(
          messages[authError.code ?? ""] ??
            "认证失败，请检查 Supabase 配置或稍后重试。",
        );
        return;
      }
      if (data.session) {
        router.replace("/");
        router.refresh();
      } else if (isSignup) {
        // Supabase may deliberately return a generic response for an existing user.
        setMessage(
          "如果该邮箱可注册，你将收到确认邮件。请在此浏览器打开链接完成确认，再登录。",
        );
      } else {
        setError("未能建立登录会话，请重试。");
      }
    } catch {
      setError("无法连接认证服务，请检查网络和 Supabase 配置后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <Link
        href="/login"
        className="mb-8 flex items-center justify-center gap-3"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-teal-800 text-xl text-white">
          ✦
        </span>
        <span className="font-semibold">Personal AI Assistant</span>
      </Link>
      <section className="panel">
        <p className="text-xs font-semibold tracking-widest text-teal-700">
          YOUR PERSONAL WORKSPACE
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          {isSignup ? "创建账号" : "欢迎回来"}
        </h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-slate-500">
          {isSignup
            ? "开启你的个人 AI 工作空间。"
            : "登录后继续你的学习与工作任务。"}
        </p>
        {!configured && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800"
          >
            <p>{unconfiguredMessage}</p>
            <p className="mt-2 text-xs">
              在 web/.env.local 配置 Supabase URL 与公开 anon key，然后重启 Web
              服务。
            </p>
          </div>
        )}
        <form onSubmit={submit} aria-busy={loading} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium">
              Email · 邮箱
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
              disabled={loading}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium"
            >
              Password · 密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? 8 : undefined}
              maxLength={128}
              disabled={loading}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
            />
            {isSignup && (
              <p className="mt-2 text-xs text-slate-400">
                至少 8 个字符，还需满足 Supabase 项目的密码策略。
              </p>
            )}
          </div>
          {isSignup && (
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-2 block text-sm font-medium"
              >
                Confirm Password · 确认密码
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                disabled={loading}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
              />
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-700"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="rounded-xl bg-teal-50 p-3 text-sm leading-6 text-teal-800"
            >
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={!configured || loading}
            className="button-primary w-full"
          >
            {loading
              ? isSignup
                ? "注册中…"
                : "登录中…"
              : isSignup
                ? "Signup · 注册"
                : "Login · 登录"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          {isSignup ? "已有账号？" : "还没有账号？"}
          <Link
            href={isSignup ? "/login" : "/signup"}
            className="ml-2 font-medium text-teal-700 hover:underline"
          >
            {isSignup ? "前往登录" : "创建账号"}
          </Link>
        </p>
      </section>
      <p className="mt-5 text-center text-xs leading-6 text-slate-400">
        账号认证使用 Supabase Auth。工作空间内容仍为 UI 演示。
      </p>
    </div>
  );
}
