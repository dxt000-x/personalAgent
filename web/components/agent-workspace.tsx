"use client";

import { useState, type FormEvent } from "react";
import { PageHeader } from "./page-header";
import { AgentTimeline } from "./agent-timeline";
import type { ExecutionStep } from "./agent-step";

const demoPrompt = "结合我的比赛资料，帮我制定接下来两周的开发计划。";
const definitions = [
  ["Understanding request", "理解目标与两周时间范围"],
  ["Reading personal memory", "演示：参考项目目标与个人偏好"],
  ["Searching knowledge base", "演示：参考比赛资料与项目说明"],
  ["Planning task", "拆分里程碑与每日重点"],
  ["Executing tools", "演示工具步骤，不执行任何操作"],
  ["Generating result", "展示固定的示例计划"],
];

export function AgentWorkspace({ isNew }: { isNew: boolean }) {
  const [request, setRequest] = useState(isNew ? "" : demoPrompt);
  const [draft, setDraft] = useState("");
  const [current, setCurrent] = useState(isNew ? -1 : 3);
  const [failed, setFailed] = useState(false);
  const complete = current === definitions.length;
  const steps: ExecutionStep[] = definitions.map(([title, description], index) => ({ title, description, status: index < current ? "success" : index === current ? (failed ? "error" : "running") : "pending" }));
  const status = failed ? "演示失败" : complete ? "演示完成" : current < 0 ? "等待任务" : "演示规划中";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    setRequest(draft.trim()); setDraft(""); setCurrent(0); setFailed(false);
  }
  function reset() { setRequest(demoPrompt); setDraft(""); setCurrent(3); setFailed(false); }

  return <>
    <PageHeader eyebrow="THINK · PLAN · ACT" title="Agent 工作空间" description="将个人背景与任务目标放在一起，清晰查看每一步。" action={<span className="badge">UI Mock · 未连接模型</span>} />
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5"><div><p className="text-xs text-slate-400">当前任务 · 演示</p><h2 className="mt-1 font-semibold">{request === demoPrompt ? "两周开发计划" : request ? "自定义演示任务" : "新任务"}</h2></div><span role="status" className={`rounded-full px-3 py-1 text-xs ${failed ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-700"}`}>{status}</span></div>
        <div className="min-h-80 space-y-6 p-6" aria-label="任务对话">
          {request ? <>
            <div className="ml-auto max-w-lg rounded-2xl rounded-tr-sm bg-slate-100 p-5"><p className="mb-2 text-xs text-slate-400">你 · 演示输入</p><p className="whitespace-pre-wrap text-sm leading-7 break-words">{request}</p></div>
            <div className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-800">✦</span><div className="min-w-0"><p className="text-sm font-semibold">Personal AI <span className="ml-2 text-xs font-normal text-slate-400">Mock response</span></p><p className="mt-3 text-sm leading-7 text-slate-500">这是执行流程演示。我将展示理解目标、参考个人背景、规划任务到输出结果的过程。当前没有读取任何资料或调用模型。</p>
              <div className="mt-4 rounded-xl border border-slate-200 p-4 text-xs text-slate-500"><p className="font-medium text-slate-700">演示上下文</p><p className="mt-2">项目：Personal AI Assistant</p><p className="mt-2">目标：AI 应用比赛 · 偏好：按阶段迭代</p></div>
              {failed && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">模拟步骤失败，未执行真实操作。点击“重试当前步骤”恢复演示。</p>}
              {complete && <div className="mt-4 rounded-xl bg-teal-50 p-4 text-sm leading-7 text-teal-900"><p className="font-semibold">固定示例结果 · 未保存</p><p>第一周：完成工作空间 UI，梳理用户场景与接口需求。</p><p>第二周：按后续任务安排接入能力，完成验证与比赛演示准备。</p><p className="mt-2 text-xs text-teal-700">该示例不会根据输入生成内容，也不会形成新记忆。</p></div>}
            </div></div>
          </> : <div className="py-12 text-center"><p className="text-3xl text-teal-700">✦</p><h3 className="mt-4 font-semibold">从一个明确的目标开始</h3><p className="mt-3 text-sm text-slate-400">输入任务，或加载两周开发计划演示。</p><button onClick={reset} className="button-secondary mt-5">加载示例任务</button></div>}
        </div>
        <form onSubmit={submit} className="border-t border-slate-100 p-5"><label htmlFor="task-input" className="mb-2 block text-xs font-medium text-slate-500">任务输入</label><textarea id="task-input" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="描述你想完成的目标…" className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-400">仅前端演示 · 不保存输入 · {draft.length}/2000</p><button type="submit" disabled={!draft.trim()} className="button-primary">发送演示任务 ↑</button></div></form>
      </section>
      <div className="space-y-4"><AgentTimeline steps={steps} /><section className="panel"><h2 className="text-sm font-semibold">演示控制</h2><p className="mt-2 text-xs leading-5 text-slate-400">手动切换状态，无自动执行或网络请求。</p><div className="mt-4 flex flex-wrap gap-2"><button className="button-primary" disabled={current < 0 || complete} onClick={() => { if (failed) setFailed(false); else setCurrent(current + 1); }}>{failed ? "重试当前步骤" : "推进演示"}</button><button className="button-secondary" disabled={current < 0 || complete || failed} onClick={() => setFailed(true)}>模拟错误</button><button className="button-secondary" onClick={reset}>重置示例</button></div></section></div>
    </div>
  </>;
}
