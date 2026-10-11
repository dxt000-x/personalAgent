"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { KnowledgeFileRow } from "@/components/knowledge-file-row";
import { KnowledgeSearch } from "@/components/knowledge-search";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_PAGE_SIZE, MAX_FILE_BYTES, type KnowledgeDocument } from "@/lib/knowledge/types";

type ApiError = { error?: { message?: string } };

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as ApiError;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch { /* Fixed fallback below; never show raw response bodies. */ }
  return `请求失败（${response.status}）。请稍后重试。`;
}

export function KnowledgeWorkspace() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const loadGeneration = useRef(0);
  const [action, setAction] = useState<string | null>(null);
  const actionRef = useRef(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);

  const loadDocuments = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadState("loading");
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = await response.json() as { documents?: KnowledgeDocument[] };
      if (loadGeneration.current !== generation) return;
      const items = Array.isArray(body.documents) ? body.documents : [];
      setDocuments(items);
      setHasMore(items.length === DOCUMENT_PAGE_SIZE);
      setLoadState("ready");
    } catch {
      if (loadGeneration.current === generation) setLoadState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++loadGeneration.current;
    fetch("/api/knowledge", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return response.json() as Promise<{ documents?: KnowledgeDocument[] }>;
      })
      .then((body) => {
        if (!active || loadGeneration.current !== generation) return;
        const items = Array.isArray(body.documents) ? body.documents : [];
        setDocuments(items);
        setHasMore(items.length === DOCUMENT_PAGE_SIZE);
        setLoadState("ready");
      })
      .catch(() => { if (active && loadGeneration.current === generation) setLoadState("error"); });
    return () => { active = false; loadGeneration.current += 1; };
  }, []);

  async function loadMore() {
    if (!hasMore || !beginAction("more")) return;
    const generation = loadGeneration.current;
    try {
      const response = await fetch(`/api/knowledge?offset=${documents.length}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = await response.json() as { documents?: KnowledgeDocument[] };
      if (loadGeneration.current !== generation) return;
      const items = Array.isArray(body.documents) ? body.documents : [];
      setDocuments((current) => [...current, ...items.filter((item) => !current.some((row) => row.id === item.id))]);
      setHasMore(items.length === DOCUMENT_PAGE_SIZE);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取更多文档失败。");
    } finally { endAction(); }
  }

  function beginAction(value: string): boolean {
    if (actionRef.current) return false;
    actionRef.current = true;
    setAction(value);
    setMessage("");
    setErrorMessage("");
    return true;
  }

  function endAction() {
    actionRef.current = false;
    setAction(null);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !beginAction("upload")) return;
    let documentId: string | null = null;
    try {
      if (file.size === 0) throw new Error("文件不能为空。");
      if (file.size > MAX_FILE_BYTES) throw new Error("文件大小不能超过 4 MiB。");
      const start = await fetch("/api/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      if (!start.ok) throw new Error(await responseMessage(start));
      const body = await start.json() as {
        document: KnowledgeDocument;
        upload: { bucket: string; path: string; contentType: string };
      };
      documentId = body.document.id;
      const supabase = createClient();
      if (!supabase) throw new Error("登录配置暂时不可用。");
      const { error } = await supabase.storage.from(body.upload.bucket).upload(body.upload.path, file, {
        contentType: body.upload.contentType, upsert: false,
      });
      if (error) {
        // A failed direct upload can leave a pending database row. Cleanup is
        // retryable through the same authenticated delete API.
        await fetch(`/api/knowledge/${documentId}`, { method: "DELETE" }).catch(() => undefined);
        throw new Error("文件上传失败，请检查网络后重试。");
      }
      const process = await fetch(`/api/knowledge/${documentId}/process`, { method: "POST" });
      if (!process.ok) throw new Error(await responseMessage(process));
      setSearchVersion((version) => version + 1);
      setMessage("文件已上传并完成正文解析。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上传失败，请稍后重试。");
    } finally {
      await loadDocuments();
      endAction();
    }
  }

  async function process(document: KnowledgeDocument) {
    if (!beginAction(document.id)) return;
    try {
      const response = await fetch(`/api/knowledge/${document.id}/process`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setSearchVersion((version) => version + 1);
      setMessage("文档处理完成。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "处理失败，请稍后重试。");
    } finally { await loadDocuments(); endAction(); }
  }

  async function remove(document: KnowledgeDocument) {
    if (!window.confirm(`确定删除“${document.file_name}”吗？`)) return;
    if (!beginAction(document.id)) return;
    try {
      const response = await fetch(`/api/knowledge/${document.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setSearchVersion((version) => version + 1);
      setMessage("文档已删除。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally { await loadDocuments(); endAction(); }
  }

  return (
    <div className="space-y-6">
      <KnowledgeSearch key={searchVersion} />
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8">
        <h2 className="font-semibold">Upload Document · 上传文档</h2>
        <p className="mt-2 text-sm text-slate-500">支持 PDF、TXT、Markdown；单个文件最多 4 MiB。扫描版 PDF 需要 OCR，当前无法提取。</p>
        <label className="button-secondary mt-5 inline-flex cursor-pointer items-center">
          {action === "upload" ? "正在上传并解析…" : "选择文件"}
          <input aria-label="选择知识库文件" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="sr-only" disabled={action !== null} onChange={(event) => void upload(event)} />
        </label>
        <p className="mt-3 text-xs text-slate-400">原文件保存在当前账号的私有空间。上传完成后可在列表删除。</p>
      </section>
      <div aria-live="polite" className="space-y-2">
        {message && <p className="rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-800">{message}</p>}
        {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>}
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between p-6">
          <h2 className="font-semibold">我的文档</h2>
          {loadState === "ready" && <span className="text-sm text-slate-500">{documents.length} 个</span>}
        </div>
        {loadState === "loading" && <p role="status" className="px-6 pb-6 text-sm text-slate-500">正在读取文档…</p>}
        {loadState === "error" && <div role="alert" className="px-6 pb-6 text-sm text-rose-700">
          无法读取文档列表。<button type="button" className="ml-2 underline" onClick={() => void loadDocuments()}>重试</button>
        </div>}
        {loadState === "ready" && documents.length === 0 && (
          <div className="border-t border-slate-100 px-6 py-12 text-center text-sm text-slate-500">还没有上传文档。选择一个 PDF、TXT 或 Markdown 文件开始。</div>
        )}
        {loadState === "ready" && documents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <caption className="sr-only">当前账号的知识库文档</caption>
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                <th scope="col" className="px-5 py-4 font-medium">文件名</th>
                <th scope="col" className="px-5 py-4 font-medium">格式</th>
                <th scope="col" className="px-5 py-4 font-medium">状态</th>
                <th scope="col" className="px-5 py-4 font-medium">上传日期</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">操作</th>
              </tr></thead>
              <tbody>{documents.map((document) => <KnowledgeFileRow key={document.id} document={document}
                busy={action !== null} onProcess={(item) => void process(item)} onDelete={(item) => void remove(item)} />)}</tbody>
            </table>
            {hasMore && <div className="border-t border-slate-100 p-4 text-center">
              <button type="button" className="button-secondary" disabled={action !== null}
                onClick={() => void loadMore()}>{action === "more" ? "正在加载…" : "加载更多"}</button>
            </div>}
          </div>
        )}
      </section>
    </div>
  );
}
