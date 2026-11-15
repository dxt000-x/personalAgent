"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";

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
  const { t, errorText, number: formatNumber } = useI18n();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const loadGeneration = useRef(0);
  const [action, setAction] = useState<string | null>(null);
  const actionRef = useRef(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "processing">("uploading");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [cleanupTarget, setCleanupTarget] = useState<{ id: string; fileName: string } | null>(null);
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

  function beginAction(value: string, progress = "正在操作…"): boolean {
    if (actionRef.current) return false;
    actionRef.current = true;
    setAction(value);
    setProgressMessage(progress);
    setMessage("");
    setErrorMessage("");
    return true;
  }

  function endAction() {
    actionRef.current = false;
    setAction(null);
  }

  // Only the ID returned by our authenticated create request is used here.
  // The existing delete API owns Storage cleanup and metadata finalization.
  async function cleanupUpload(id: string): Promise<"deleted" | "missing"> {
    const response = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (response.status === 404) return "missing";
    if (response.status !== 204) throw new Error("cleanup failed");
    return "deleted";
  }

  async function retryCleanup() {
    if (!cleanupTarget || !beginAction("cleanup")) return;
    try {
      const result = await cleanupUpload(cleanupTarget.id);
      setCleanupTarget(null);
      setSearchVersion((version) => version + 1);
      setMessage(result === "deleted" ? "上传失败的记录和原件已清理，可以重新上传。"
        : "该记录已不存在；未对其他文件执行清理。请核对列表后再上传。");
    } catch {
      setErrorMessage("清理未完成，记录或原件可能仍然存在。请恢复网络后重试清理，暂勿重复上传。");
    } finally { await loadDocuments(); endAction(); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || cleanupTarget || !beginAction("upload")) return;
    let documentId: string | null = null;
    let storageUploaded = false;
    setUploadPhase("uploading");
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
      if (error) throw new Error("文件上传失败。");
      storageUploaded = true;
      setUploadPhase("processing");
      const process = await fetch(`/api/knowledge/${documentId}/process`, { method: "POST" });
      if (!process.ok) throw new Error(await responseMessage(process));
      setSearchVersion((version) => version + 1);
      setMessage("文件已上传并完成正文解析。");
    } catch (error) {
      if (documentId && !storageUploaded) {
        try {
          const result = await cleanupUpload(documentId);
          setSearchVersion((version) => version + 1);
          setErrorMessage(result === "deleted" ? "文件上传失败，记录和原件已清理。请检查网络后重新上传。"
            : "文件上传失败，该记录已不存在。请核对列表后再上传。");
        } catch {
          setCleanupTarget({ id: documentId, fileName: file.name });
          setErrorMessage("文件上传失败，自动清理未完成，记录或原件可能仍然存在。请重试清理，暂勿重复上传。");
        }
      } else {
        // Processing failures retain the uploaded original for safe server retry.
        setErrorMessage(error instanceof Error ? error.message : "上传失败，请稍后重试。");
      }
    } finally { await loadDocuments(); endAction(); }
  }

  async function process(document: KnowledgeDocument) {
    if (!document.processing_action || !beginAction(document.id, "正在处理文档…")) return;
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
    if (!window.confirm(t("确定删除“{0}”吗？", {0: (document.file_name)}))) return;
    if (!beginAction(document.id, "正在删除文档…")) return;
    try {
      const response = await fetch(`/api/knowledge/${document.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setSearchVersion((version) => version + 1);
      if (cleanupTarget?.id === document.id) setCleanupTarget(null);
      setMessage("文档已删除。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally { await loadDocuments(); endAction(); }
  }

  return (
    <div className="space-y-6">
      <Link href="/training" className="button-secondary inline-flex min-h-11 items-center">{t("知识训练")}</Link>
      <KnowledgeSearch key={searchVersion} />
      <section className="panel" aria-label={t("知识分类与知识点")}><h2 className="text-lg font-semibold">{t("知识分类与知识点")}</h2><p className="mt-2 text-sm text-slate-500">{t("分类保存、标签编辑和人工确认暂未开放。知识训练可使用原有文档，不保存分类结果。")}</p></section>
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8">
        <h2 className="font-semibold">{t("Upload Document · 上传文档")}</h2>
        <p className="mt-2 text-sm text-slate-500">{t("支持 PDF、TXT、Markdown；单个文件最多 4 MiB。扫描版 PDF 需要 OCR，当前无法提取。")}</p>
        <label className="button-secondary mt-5 inline-flex min-h-11 cursor-pointer items-center focus-within:outline-2 focus-within:outline-teal-700">
          {action === "upload" ? uploadPhase === "uploading" ? t("正在上传…") : t("正在解析…") : t("选择文件")}
          <input aria-label={t("选择知识库文件")} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="sr-only" disabled={action !== null || cleanupTarget !== null} onChange={(event) => void upload(event)} />
        </label>
        <p className="mt-3 text-xs text-slate-400">{t("原文件保存在当前账号的私有空间。上传完成后可在列表删除。")}</p>
      </section>
      <div aria-live="polite" className="space-y-2">
        {cleanupTarget && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>“{cleanupTarget.fileName}{t("”的清理结果尚未确认，上传已暂停。请先清理该记录。")}</p>
          <button type="button" className="button-secondary mt-2" disabled={action !== null}
            onClick={() => void retryCleanup()}>{action === "cleanup" ? t("正在清理…") : t("重试清理")}</button>
        </div>}
        {message && <p className="rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-800">{t(message)}</p>}
        {errorMessage && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorText(errorMessage)}</p>}
      </div>
      <section aria-busy={loadState === "loading"} className="min-h-[16rem] overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
          <h2 className="font-semibold">{t("我的文档")}</h2>
          <div className="flex items-center gap-3">
            {loadState === "ready" && <span className="text-sm text-slate-500">{formatNumber(documents.length)} {" "}{t("个")}</span>}
            <button type="button" className="button-secondary" disabled={action !== null || loadState === "loading"}
              onClick={() => void loadDocuments()}>{t("刷新状态")}</button>
          </div>
        </div>
        <div className="min-h-6 px-4 text-sm text-slate-500 sm:px-6" aria-live="polite">
          {loadState === "loading" && <p role="status">{documents.length ? t("正在刷新，暂时显示上次结果…") : t("正在读取文档…")}</p>}
        </div>
        {loadState === "error" && <div role="alert" className="px-6 pb-6 text-sm text-rose-700">
          {t("无法读取文档列表。")}<button type="button" className="ml-2 underline" onClick={() => void loadDocuments()}>{t("重试")}</button>
        </div>}
        {loadState === "ready" && documents.length === 0 && (
          <div className="border-t border-slate-100 px-6 py-12 text-center text-sm text-slate-500">{t("还没有上传文档。选择一个 PDF、TXT 或 Markdown 文件开始。")}</div>
        )}
        {documents.length > 0 && (
          <div>
            <table className="block w-full text-left text-sm xl:table">
              <caption className="sr-only">{t("当前账号的知识库文档")}</caption>
              <thead className="sr-only bg-slate-50 xl:not-sr-only xl:table-header-group text-xs text-slate-500"><tr>
                <th scope="col" className="px-5 py-4 font-medium">{t("文件名")}</th>
                <th scope="col" className="px-5 py-4 font-medium">{t("格式")}</th>
                <th scope="col" className="px-5 py-4 font-medium">{t("状态")}</th>
                <th scope="col" className="px-5 py-4 font-medium">{t("更新时间")}</th>
                <th scope="col" className="px-5 py-4 text-right font-medium">{t("操作")}</th>
              </tr></thead>
              <tbody className="block xl:table-row-group">{documents.map((document) => <KnowledgeFileRow key={document.id} document={document}
                busy={action !== null || loadState !== "ready"} pendingLabel={action === document.id ? progressMessage : undefined} onProcess={(item) => void process(item)} onDelete={(item) => void remove(item)} />)}</tbody>
            </table>
            {hasMore && <div className="border-t border-slate-100 p-4 text-center">
              <button type="button" className="button-secondary" disabled={action !== null}
                onClick={() => void loadMore()}>{action === "more" ? t("正在加载…") : t("加载更多")}</button>
            </div>}
          </div>
        )}
      </section>
    </div>
  );
}
