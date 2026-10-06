import {
  KnowledgeFileRow,
  type KnowledgeFile,
} from "@/components/knowledge-file-row";
import { PageHeader } from "@/components/page-header";

const files: KnowledgeFile[] = [
  {
    name: "AI 比赛项目说明.pdf",
    type: "PDF",
    status: "演示：已就绪",
    uploadedAt: "2026-10-02",
  },
  {
    name: "产品需求草稿.docx",
    type: "DOCX",
    status: "演示：已就绪",
    uploadedAt: "2026-10-03",
  },
  {
    name: "开发笔记.md",
    type: "Markdown",
    status: "演示：待处理",
    uploadedAt: "2026-10-05",
  },
  {
    name: "资料摘录.txt",
    type: "TXT",
    status: "演示：处理失败",
    uploadedAt: "2026-10-06",
  },
];

export default function KnowledgePage() {
  return (
    <>
      <PageHeader
        eyebrow="YOUR KNOWLEDGE, ORGANIZED"
        title="Knowledge Base · 个人知识库"
        description="未来在这里管理个人资料，为 Agent 提供可检索的知识。"
      />
      <section className="mb-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <p aria-hidden="true" className="text-3xl text-teal-700">
          ↥
        </p>
        <h2 className="mt-3 font-semibold">Upload Document · 上传文档</h2>
        <p className="mt-2 text-sm text-slate-400">
          支持类型规划：PDF、DOCX、TXT、Markdown
        </p>
        <button disabled className="button-secondary mt-5">
          选择文件 · Coming Soon
        </button>
        <p className="mt-3 text-xs text-slate-400">
          上传入口仅为占位，不接受文件或拖拽上传。
        </p>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="font-semibold">
              演示文档{" "}
              <span className="ml-2 text-sm font-normal text-slate-400">
                4 个
              </span>
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              固定示例列表 · 未上传、解析、embedding 或检索
            </p>
          </div>
          <button disabled className="button-secondary">
            ⌕ Search Knowledge · 尚未开放
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">
              演示文件列表，所有处理状态均为 Mock
            </caption>
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                {[
                  "File Name / 文件名",
                  "Type / 类型",
                  "Status / 状态",
                  "Uploaded At / 示例上传时间",
                ].map((label) => (
                  <th key={label} scope="col" className="px-5 py-4 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <KnowledgeFileRow key={file.name} file={file} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
