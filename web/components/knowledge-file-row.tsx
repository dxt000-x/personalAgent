export type KnowledgeFile = {
  name: string;
  type: string;
  status: "演示：已就绪" | "演示：待处理" | "演示：处理失败";
  uploadedAt: string;
};

export function KnowledgeFileRow({ file }: { file: KnowledgeFile }) {
  const color =
    file.status === "演示：已就绪"
      ? "bg-teal-50 text-teal-700"
      : file.status === "演示：处理失败"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";
  return (
    <tr className="border-t border-slate-100">
      <td className="px-5 py-5 font-medium">
        <span aria-hidden="true" className="mr-3 text-slate-400">
          ▤
        </span>
        {file.name}
      </td>
      <td className="px-5 py-5 text-slate-500">{file.type}</td>
      <td className="px-5 py-5">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs ${color}`}>
          {file.status}
        </span>
      </td>
      <td className="px-5 py-5 text-slate-400">{file.uploadedAt}</td>
    </tr>
  );
}
