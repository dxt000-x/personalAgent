export type MemoryItem = {
  category: string;
  title: string;
  content: string;
  createdAt: string;
  source: string;
};

export function MemoryCard({ memory }: { memory: MemoryItem }) {
  return (
    <article className="panel">
      <div className="flex items-center justify-between gap-2">
        <span className="badge">{memory.category}</span>
        <span className="text-xs text-slate-400">Mock</span>
      </div>
      <h3 className="mt-4 font-semibold">{memory.title}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-500">{memory.content}</p>
      <dl className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
        <div className="flex gap-3">
          <dt>创建时间</dt>
          <dd>{memory.createdAt}</dd>
        </div>
        <div className="flex gap-3">
          <dt>来源</dt>
          <dd>{memory.source}</dd>
        </div>
      </dl>
      <div className="mt-5 flex gap-2">
        <button disabled className="button-secondary" title="编辑功能尚未实现">
          Edit · 编辑
        </button>
        <button disabled className="button-secondary" title="删除功能尚未实现">
          Delete · 删除
        </button>
      </div>
    </article>
  );
}
