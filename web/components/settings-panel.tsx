"use client";

import { useI18n, LanguageSwitcher } from "@/components/i18n-provider";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ProviderId = "ollama" | "openrouter" | "openai" | "deepseek" | "gemini";
type ProviderSummary = { id: ProviderId; configured: boolean; availability: "unknown" | "available" | "unavailable" };
const providers: { id: ProviderId; name: string }[] = [
  { id: "ollama", name: "Ollama · 本地" }, { id: "openrouter", name: "OpenRouter" },
  { id: "openai", name: "OpenAI" }, { id: "deepseek", name: "DeepSeek" }, { id: "gemini", name: "Gemini" },
];
const levels = ["仅回答问题", "执行前由用户确认", "自动执行安全操作（规划）", "高权限操作需确认（规划）"];

export function SettingsPanel() {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<ProviderSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">("loading");
  const pending = useRef<AbortController | null>(null);
  const [model, setModel] = useState("Auto");
  const [level, setLevel] = useState(1);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState("loading");
    try {
      const response = await fetch("/api/ai/providers", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) { setStatuses([]); setState("auth"); return; }
      if (!response.ok) throw new Error("status unavailable");
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!Array.isArray(body)) throw new Error("invalid status");
      const safe: ProviderSummary[] = [];
      for (const value of body) {
        if (!value || typeof value !== "object") throw new Error("invalid status");
        const row = value as Record<string, unknown>;
        if (!providers.some((provider) => provider.id === row.id)) continue;
        if (typeof row.configured !== "boolean" || !["unknown", "available", "unavailable"].includes(String(row.availability))
          || safe.some((item) => item.id === row.id)) throw new Error("invalid status");
        // Explicit allowlist: never render arbitrary model/env/error fields.
        safe.push({ id: row.id as ProviderId, configured: row.configured, availability: row.availability as ProviderSummary["availability"] });
      }
      if (!safe.length) throw new Error("missing status");
      setStatuses(safe); setState("ready");
    } catch {
      if (!controller.signal.aborted) { setStatuses([]); setState("error"); }
    } finally { if (pending.current === controller) pending.current = null; }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; pending.current?.abort(); };
  }, [load]);

  return <div className="space-y-6">
    <section className="panel"><h2 className="mb-4 text-lg font-semibold">{t("语言")}</h2><LanguageSwitcher />
      <p className="mt-3 text-sm text-slate-500">{t("语言偏好仅保存在本机当前账号，不影响文档原文或模型回复。")}</p></section>
    <section className="panel" aria-labelledby="provider-status-title" aria-busy={state === "loading"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium tracking-widest text-teal-700">{t("API PROVIDERS")}</p>
          <h2 id="provider-status-title" className="mt-2 text-lg font-semibold">{t("模型服务配置状态 · 只读")}</h2></div>
        <button type="button" className="button-secondary" disabled={state === "loading" || state === "auth"} onClick={() => void load()}>
          {state === "loading" ? t("正在读取…") : t("刷新配置状态")}</button>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{t("这里只查看配置是否存在，不展示或收集 API Key。已配置不代表调用成功；云端健康状态须通过真实请求单独验证。")}</p>
      <div className="mt-4 min-h-6" aria-live="polite">
        {state === "loading" && <p role="status" className="text-sm text-slate-500">{t("正在读取服务状态…")}</p>}
        {state === "error" && <p role="alert" className="text-sm text-rose-700">{t("暂时无法读取服务状态。请检查网络后刷新配置状态。")}</p>}
        {state === "auth" && <p role="alert" className="text-sm text-rose-700">{t("登录状态已失效。")}<Link href="/login" className="ml-2 underline">{t("重新登录")}</Link></p>}
      </div>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => {
          const value = state === "ready" ? statuses.find((item) => item.id === provider.id) : undefined;
          const label = !value ? "尚未核验" : !value.configured ? "未配置"
            : value.availability === "available" ? "已配置 · 当前可用"
              : value.availability === "unavailable" ? "已配置 · 当前不可用" : "已配置 · 健康状态未知";
          return <li key={provider.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-medium">{t(provider.name)}</h3><p className="mt-2 text-xs leading-5 text-slate-500">{t(label)}</p></li>;
        })}
      </ul>
      <Link href="/agent" className="button-primary mt-5">{t("前往 Agent 选择实际 Provider →")}</Link>
    </section>
    <section className="panel">
      <h2 className="text-lg font-semibold">{t("配置与能力边界")}</h2>
      <ul className="mt-3 space-y-3 text-sm leading-7 text-slate-600">
        <li>{t("模型和密钥由服务端环境配置管理，当前页面没有修改或保存 API 配置的接口。")}</li>
        <li>{t("工具执行需要 Plan → 用户确认 → Execute；当前仅支持读取 UTC 时间。")}</li>
        <li>{t("本地连接器、文件访问及命令执行尚未实现；Ollama 通过独立模型接口接入，不依赖连接器。")}</li>
      </ul>
    </section>
    <details className="panel">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">{t("设置界面预览 · 不保存、不影响实际行为")}</summary>
      <p className="mt-3 text-sm leading-6 text-slate-500">{t("以下仅用于了解界面设计。选择不会改变 Agent 的 Provider、工具权限或服务端配置；离开或刷新后重置。")}</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <fieldset className="space-y-2"><legend className="mb-3 text-sm font-medium">{t("预览模型")}</legend>
          {["Auto", ...providers.map((provider) => provider.id)].map((name) => <label key={name}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm">
            <input type="radio" name="preview-model" value={name} checked={model === name} onChange={() => { setModel(name); setNotice(""); }} className="accent-teal-800"/>{t(name)}</label>)}
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-3 text-sm font-medium">{t("自主程度设计预览")}</legend>
          {levels.map((name, index) => <label key={name} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-6">
            <input type="radio" name="preview-autonomy" checked={level === index} onChange={() => { setLevel(index); setNotice(""); }} className="mt-1 accent-teal-800"/>{t(name)}</label>)}
        </fieldset>
      </div>
      <p role="status" className="mt-4 text-sm text-slate-500">{t("当前预览：")}{t(model)} / {t(levels[level])}{t("。未保存，未改变实际行为。")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="button-secondary" onClick={() => { setModel("Auto"); setLevel(1); setNotice("预览已重置，未保存任何设置。"); }}>{t("重置预览")}</button>
        <button type="button" className="button-secondary" disabled>{t("保存设置 · 尚未开放")}</button>
      </div>
      {notice && <p role="status" className="mt-3 text-sm text-teal-700">{t(notice)}</p>}
    </details>
  </div>;
}
