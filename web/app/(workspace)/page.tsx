import Link from "next/link";
import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { NewTaskLink } from "@/components/new-task-link";

const recentTasks = [
  { title: "制定两周开发计划", status: "规划中", date: "演示 · 今天" },
  { title: "整理比赛资料目录", status: "已完成", date: "演示 · 昨天" },
  { title: "梳理项目架构", status: "已完成", date: "演示 · 10 月 4 日" },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title="欢迎回来"
        description="Your personal AI workspace · 从今天最重要的事开始。"
        action={
          <NewTaskLink className="button-primary">＋ 开始新任务</NewTaskLink>
        }
      />
      <section className="mb-7 flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-teal-900 p-7 text-white">
        <div>
          <p className="text-xs text-teal-200">
            CONTINUE PREVIOUS TASK · 演示任务
          </p>
          <h2 className="mt-3 text-xl font-semibold">
            为 AI 比赛制定两周开发计划
          </h2>
          <p className="mt-2 text-sm text-teal-100">
            已梳理项目背景，下一步：规划任务与里程碑。
          </p>
        </div>
        <Link
          href="/agent"
          className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-50"
        >
          继续上次任务 →
        </Link>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardCard title="今日重点" subtitle="TODAY’S FOCUS">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              ◎
            </span>
            <div>
              <h3 className="font-medium">Build Agent UI</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                搭建 Agent 工作空间与执行过程，让每一步都有清晰的状态。
              </p>
              <span className="badge mt-4">演示 · 高优先级</span>
            </div>
          </div>
        </DashboardCard>
        <DashboardCard title="进行中的项目" subtitle="ACTIVE PROJECTS">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Personal AI Assistant</h3>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700">
              Development
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            AI 应用比赛 · 从基础架构到个人 Agent
          </p>
          <div className="mt-6 flex justify-between text-xs text-slate-500">
            <span>演示进度</span>
            <span>35%</span>
          </div>
          <div
            role="progressbar"
            aria-label="演示项目进度"
            aria-valuenow={35}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
          >
            <div className="h-full w-[35%] rounded-full bg-teal-700" />
          </div>
        </DashboardCard>
        <DashboardCard title="最近任务" subtitle="RECENT TASKS">
          <ul className="divide-y divide-slate-100">
            {recentTasks.map((task) => (
              <li
                key={task.title}
                className="flex items-center justify-between gap-4 py-3 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{task.date}</p>
                </div>
                <span className="badge">{task.status}</span>
              </li>
            ))}
          </ul>
        </DashboardCard>
        <DashboardCard title="AI 记得的重要事项" subtitle="AI MEMORIES">
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              AI competition project in progress
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              当前重点是 Personal AI Assistant
              比赛项目，优先完成可演示的产品骨架。
            </p>
            <p className="mt-3 text-xs text-amber-700">
              演示记忆 · 来源：项目背景
            </p>
          </div>
          <Link
            href="/memory"
            className="mt-5 inline-block text-sm font-medium text-teal-700"
          >
            查看个人记忆 →
          </Link>
        </DashboardCard>
      </div>
    </>
  );
}
