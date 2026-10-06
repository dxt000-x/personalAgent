export type StepStatus = "pending" | "running" | "success" | "error";
export type ExecutionStep = { title: string; description: string; status: StepStatus };

const appearances: Record<StepStatus, { symbol: string; label: string; color: string }> = {
  pending: { symbol: "○", label: "待执行", color: "bg-slate-100 text-slate-400" },
  running: { symbol: "●", label: "进行中", color: "bg-blue-50 text-blue-700" },
  success: { symbol: "✓", label: "已完成", color: "bg-teal-50 text-teal-700" },
  error: { symbol: "!", label: "失败", color: "bg-red-50 text-red-700" },
};

export function AgentStep({ step, last }: { step: ExecutionStep; last: boolean }) {
  const appearance = appearances[step.status];
  return <li className="relative flex gap-3 pb-6 last:pb-0">
    {!last && <span aria-hidden="true" className="absolute top-8 bottom-0 left-4 w-px bg-slate-200" />}
    <span aria-hidden="true" className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${appearance.color}`}>{appearance.symbol}</span>
    <div className="min-w-0 flex-1 pt-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{step.title}</p><span className={`rounded-full px-2 py-0.5 text-[10px] ${appearance.color}`}>{appearance.label}</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{step.description}</p></div>
  </li>;
}
