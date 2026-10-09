import type { KnowledgeDocument } from "@/lib/knowledge/types";

const statusLabels: Record<KnowledgeDocument["status"], string> = {
  uploading: "待处理", processing: "解析中", ready: "已就绪",
  failed: "处理失败", deleting: "待删除",
};

export function KnowledgeFileRow({ document, busy, onProcess, onDelete }: {
  document: KnowledgeDocument;
  busy: boolean;
  onProcess: (document: KnowledgeDocument) => void;
  onDelete: (document: KnowledgeDocument) => void;
}) {
  const color = document.status === "ready" ? "bg-teal-50 text-teal-700"
    : document.status === "failed" || document.status === "deleting"
      ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
  return (
    <tr className="border-t border-slate-100">
      <td className="px-5 py-5 font-medium break-all">{document.file_name}</td>
      <td className="px-5 py-5 text-slate-500">{document.file_type.toUpperCase()}</td>
      <td className="px-5 py-5">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs ${color}`}>
          {statusLabels[document.status]}
        </span>
        {document.status === "ready" && <span className="ml-2 text-xs text-slate-400">{document.chunk_count} 段</span>}
      </td>
      <td className="px-5 py-5 text-slate-500">{new Date(document.created_at).toLocaleDateString("zh-CN")}</td>
      <td className="px-5 py-5 text-right whitespace-nowrap">
        {(document.status === "uploading" || document.status === "processing") && (
          <button type="button" disabled={busy} onClick={() => onProcess(document)}
            className="mr-3 text-sm font-medium text-teal-700 disabled:opacity-50">继续处理</button>
        )}
        <button type="button" disabled={busy} onClick={() => onDelete(document)}
          className="text-sm font-medium text-rose-700 disabled:opacity-50">
          {document.status === "deleting" ? "重试删除" : "删除"}
        </button>
      </td>
    </tr>
  );
}
