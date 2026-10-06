import type { Metadata } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
  title: "Personal AI Assistant",
  description: "面向大学生与年轻职场人的个人 AI 工作空间 UI 演示。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><div className="min-h-screen lg:flex"><AppSidebar /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-6 py-4 text-xs text-slate-400 lg:px-10"><span>个人工作空间 / Personal workspace</span><span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">UI Demo · 所有内容均为演示数据</span></div><main className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">{children}</main></div></div></body>
    </html>
  );
}
