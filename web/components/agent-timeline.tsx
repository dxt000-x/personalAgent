import { AgentStep, type ExecutionStep } from "./agent-step";

export function AgentTimeline({ steps }: { steps: ExecutionStep[] }) {
  return (
    <section className="panel">
      <p className="text-xs text-slate-400">AGENT EXECUTION · UI MOCK</p>
      <h2 className="mt-1 text-lg font-semibold">执行过程</h2>
      <p className="mt-2 mb-6 text-xs leading-5 text-slate-400">
        演示步骤，不代表真实记忆读取、检索或工具调用。
      </p>
      <ol aria-label="Agent 演示执行步骤">
        {steps.map((step, index) => (
          <AgentStep
            key={step.title}
            step={step}
            last={index === steps.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}
