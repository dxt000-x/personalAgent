"use client";

import { useI18n } from "@/components/i18n-provider";

import { useEffect, useRef } from "react";
import type { KnowledgeDocument } from "@/lib/knowledge/types";

const statusLabels: Record<KnowledgeDocument["status"], string> = {
  uploading: "待完成上传", processing: "处理中", ready: "已就绪",
  failed: "处理失败", deleting: "删除中",
};

export function KnowledgeFileRow({ document, busy, pendingLabel, onProcess, onDelete }: {
  document: KnowledgeDocument;
  busy: boolean;
  pendingLabel?: string;
  onProcess: (document: KnowledgeDocument) => void;
  onDelete: (document: KnowledgeDocument) => void;
}) {
  const { t, locale, number: formatNumber } = useI18n();
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (window.location.hash === `#knowledge-document-${document.id}`) { row.current?.scrollIntoView?.({ block: "center" });row.current?.focus(); } }, [document.id]);
  const color = document.status === "ready" ? "bg-teal-50 text-teal-700"
    : document.status === "failed" || document.status === "deleting"
      ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
  return (
    <tr ref={row} id={`knowledge-document-${document.id}`} tabIndex={-1} className="scroll-mt-6 grid min-w-0 gap-3 border-t border-slate-100 p-4 xl:table-row xl:p-0">
      <td className="min-w-0 font-medium break-all xl:table-cell xl:px-4 xl:py-5">{document.file_name}</td>
      <td className="text-slate-500 xl:table-cell xl:px-4 xl:py-5">{document.file_type.toUpperCase()}</td>
      <td className="xl:table-cell xl:px-4 xl:py-5">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs ${color}`}>
          {document.status === "processing" && document.processing_action === "recover"
            ? t("待恢复") : t(statusLabels[document.status])}
        </span>
        {document.status === "uploading" && <p className="mt-2 text-xs text-slate-500">{t("上传可能未完成；请刷新状态，若已中断请删除此记录后重新上传。")}</p>}
        {document.status === "processing" && !document.processing_action && <p className="mt-2 text-xs text-slate-500">{t("请稍候并刷新状态；达到恢复窗口后可尝试恢复。")}</p>}
        {document.status === "failed" && document.failure_kind === "invalid_file" && <p className="mt-2 text-xs text-slate-500">{t("文件无效，请删除记录后上传修正的文件。")}</p>}
        {document.status === "ready" && <span className="ml-2 text-xs text-slate-400">{formatNumber(document.chunk_count)} {" "}{t("段")}</span>}
      </td>
      <td className="text-slate-500 xl:table-cell xl:px-4 xl:py-5"><span className="mr-2 text-xs xl:hidden">{t("更新于")}</span><time dateTime={document.updated_at}>{new Date(document.updated_at).toLocaleString(locale, { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></td>
      <td className="xl:table-cell xl:px-4 xl:py-5 xl:text-right">
        <div className="flex flex-wrap gap-2 xl:justify-end">
        {((document.status === "processing" && document.processing_action === "recover") ||
          (document.status === "failed" && document.failure_kind === "temporary" && document.processing_action === "retry")) && (
          <button type="button" disabled={busy} onClick={() => onProcess(document)}
            className="button-secondary min-h-11 text-teal-700">
            {document.status === "failed" ? t("重试处理") : t("尝试恢复")}</button>
        )}
        <button type="button" disabled={busy} onClick={() => onDelete(document)}
          className="button-secondary min-h-11 text-rose-700">
          {document.status === "deleting" ? t("重试删除") : t("删除")}
        </button>
        </div>
        {pendingLabel && <p role="status" className="mt-2 text-xs text-slate-500">{t(pendingLabel)}</p>}
      </td>
    </tr>
  );
}
