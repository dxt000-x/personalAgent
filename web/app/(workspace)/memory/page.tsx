import { MemoryCard, type MemoryItem } from "@/components/memory-card";
import { PageHeader } from "@/components/page-header";

const memories: MemoryItem[] = [
  {
    category: "Long-term Goals · 长期目标",
    title: "建立持续理解用户的个人助手",
    content: "通过 AI 应用比赛，探索个人背景、知识与任务规划的结合。",
    createdAt: "2026-10-01",
    source: "演示 · 用户目标描述",
  },
  {
    category: "Projects · 项目",
    title: "Personal AI Assistant",
    content: "当前阶段是 Web 界面骨架，先完成可演示的工作空间。",
    createdAt: "2026-10-02",
    source: "演示 · 项目背景",
  },
  {
    category: "Preferences · 偏好",
    title: "按阶段交付，保持简单",
    content: "优先中文界面，使用清晰步骤与简洁布局组织信息。",
    createdAt: "2026-10-03",
    source: "演示 · 偏好描述",
  },
  {
    category: "Important Dates · 重要日期",
    title: "两周计划复盘",
    content:
      "10 月 20 日检查演示准备情况。此日期仅为示例，不代表真实比赛截止日期。",
    createdAt: "2026-10-04",
    source: "演示 · 示例日程",
  },
  {
    category: "Recent Memories · 最近记忆",
    title: "本周重点：Build Agent UI",
    content: "关注任务输入、Agent Execution 与各类状态的可视化。",
    createdAt: "2026-10-06",
    source: "演示 · 示例任务摘要",
  },
];

export default function MemoryPage() {
  return (
    <>
      <PageHeader
        eyebrow="PERSONAL CONTEXT"
        title="Personal Memory · 个人记忆"
        description="长期目标、项目与偏好，为未来的任务提供个人背景。"
      />
      <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50 px-5 py-4 text-xs leading-6 text-amber-800">
        以下 5 条均为固定演示数据，未从用户行为生成或读取。Edit / Delete
        为预留入口，当前不可操作。
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {memories.map((memory) => (
          <MemoryCard key={memory.category} memory={memory} />
        ))}
      </div>
    </>
  );
}
