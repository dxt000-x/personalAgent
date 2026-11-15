"use client";

import { useI18n } from "@/components/i18n-provider";

import Link from "next/link";
import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { NewTaskLink } from "@/components/new-task-link";

export default function DashboardPage() {
  const { t } = useI18n();
  return <>
    <PageHeader eyebrow="YOUR PERSONAL AI WORKSPACE" title="从一个问题开始"
      description="对话、个人记忆与文档资料，在一个工作空间中协作。"
      action={<NewTaskLink className="button-primary">{t("＋ 开始新任务")}</NewTaskLink>} />
    <section className="mb-7 rounded-2xl bg-teal-900 p-6 text-white sm:p-8">
      <p className="text-xs font-medium tracking-widest text-teal-200">{t("AGENT WORKSPACE")}</p>
      <h2 className="mt-3 text-2xl font-semibold">{t("带着你的资料，整理下一步")}</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-teal-100">{t("与 AI 对话，按需引用个人记忆和知识库。先查看计划，再决定是否确认受限工具执行。")}</p>
      <Link href="/agent" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-50">{t("进入 Agent 工作区 →")}</Link>
      <p className="mt-3 text-xs leading-5 text-teal-200">{t("对话仅保存在当前页面内存；刷新后不会恢复历史任务。")}</p>
    </section>
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="个人记忆" subtitle="PERSONAL MEMORY">
        <p className="text-sm leading-7 text-slate-600">{t("保存重要偏好与背景，让后续对话获得个人上下文。记忆由你查看、修改和删除。")}</p>
        <Link href="/memory" className="mt-4 inline-flex min-h-11 items-center font-medium text-teal-700">{t("管理我的记忆 →")}</Link>
      </DashboardCard>
      <DashboardCard title="文档知识库" subtitle="KNOWLEDGE BASE">
        <p className="text-sm leading-7 text-slate-600">{t("上传 PDF、TXT 或 Markdown，按关键词查找正文。对话时可主动开启文档引用。")}</p>
        <Link href="/knowledge" className="mt-4 inline-flex min-h-11 items-center font-medium text-teal-700">{t("打开我的文档 →")}</Link>
      </DashboardCard>
    </div>
    <details className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-600">{t("产品预览 · 任务与项目看板（演示数据）")}</summary>
      <p className="mt-3 text-sm leading-6 text-slate-500">{t("以下仅展示未来看板样式。任务历史与恢复功能尚未实现，示例不代表你的任务或真实项目进度。")}</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4">
          <h2 className="text-sm font-medium">{t("最近任务 · 演示")}</h2>
          <ul className="mt-3 space-y-3 text-sm text-slate-500"><li>{t("制定两周开发计划 · 示例")}</li><li>{t("整理比赛资料目录 · 示例")}</li></ul>
          <p className="mt-4 text-xs text-slate-500">{t("暂不支持“继续上次任务”；请从新任务开始。")}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <h2 className="text-sm font-medium">{t("PersonalAgent · 演示项目")}</h2>
          <p className="mt-3 text-xs text-slate-500">{t("示例进度 35% · 非实际完成度")}</p>
          <div role="progressbar" aria-label={t("演示项目进度，非实际完成度")} aria-valuenow={35} aria-valuemin={0} aria-valuemax={100}
            className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-[35%] rounded-full bg-teal-700" /></div>
        </div>
      </div>
    </details>
  </>;
}
