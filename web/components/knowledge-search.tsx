"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_SEARCH_QUERY_CHARS, type KnowledgeSearchResult } from "@/lib/knowledge/search-types";

type SearchState = "idle" | "loading" | "ready" | "error";

export function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generation.current += 1;
    pending.current?.abort();
  }, []);

  function changeQuery(value: string) {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
    setQuery(value);
    setResults([]);
    setState("idle");
    setErrorMessage("");
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = query.trim();
    generation.current += 1;
    pending.current?.abort();
    const current = generation.current;
    setResults([]);
    if (!keyword || keyword.length > MAX_SEARCH_QUERY_CHARS || !/^[\p{L}\p{M}\p{N} ]+$/u.test(keyword)) {
      setState("error");
      setErrorMessage("请输入 1–100 字的文字或数字关键词，可包含空格。");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setState("loading");
    setErrorMessage("");
    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: keyword }), cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("检索暂时不可用，请稍后重试。");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) {
        throw new Error("检索暂时不可用，请稍后重试。");
      }
      if (generation.current !== current || controller.signal.aborted) return;
      setResults((body as { results: KnowledgeSearchResult[] }).results);
      setState("ready");
    } catch {
      if (generation.current !== current || controller.signal.aborted) return;
      setState("error");
      setErrorMessage("检索暂时不可用，请稍后重试。");
    } finally {
      if (generation.current === current) pending.current = null;
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold">文档关键词检索</h2>
      <p className="mt-2 text-sm text-slate-500">仅查找当前账号已就绪文档中的文字；暂不支持语义检索。</p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void search(event)}>
        <input aria-label="知识库搜索关键词" value={query} maxLength={MAX_SEARCH_QUERY_CHARS}
          onChange={(event) => changeQuery(event.target.value)} placeholder="输入文字或数字关键词"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-teal-600" />
        <button type="submit" className="button-secondary" disabled={state === "loading"}>
          {state === "loading" ? "检索中…" : "搜索"}
        </button>
      </form>
      <div className="mt-4" aria-live="polite">
        {state === "loading" && <p role="status" className="text-sm text-slate-500">正在检索文档…</p>}
        {state === "error" && <p role="alert" className="text-sm text-rose-700">{errorMessage}</p>}
        {state === "ready" && results.length === 0 && <p className="text-sm text-slate-500">没有找到匹配片段。</p>}
        {state === "ready" && results.length > 0 && <ul className="space-y-3">
          {results.map((result) => <li key={`${result.documentId}:${result.chunkIndex}`}
            className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">{result.fileName} · 片段 {result.chunkIndex + 1}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{result.snippet}</p>
          </li>)}
        </ul>}
      </div>
    </section>
  );
}
