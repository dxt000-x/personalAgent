"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewTaskLink } from "./new-task-link";

const navigation = [
  { href: "/", label: "Dashboard", symbol: "▦" },
  { href: "/agent", label: "Agent", symbol: "✦" },
  { href: "/memory", label: "Memory", symbol: "◇" },
  { href: "/knowledge", label: "Knowledge Base", symbol: "▤" },
  { href: "/settings", label: "Settings", symbol: "⚙" },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white p-5 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-r lg:border-b-0">
      <Link
        href="/"
        className="flex items-center gap-3 px-2 py-3"
        aria-label="Personal AI Assistant 首页"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-teal-800 text-xl text-white">
          ✦
        </span>
        <span className="text-sm font-bold leading-5">
          Personal AI
          <span className="block font-normal text-slate-500">Assistant</span>
        </span>
      </Link>
      <NewTaskLink className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900">
        <span aria-hidden="true">＋</span> New Task
      </NewTaskLink>
      <p className="mt-8 mb-3 px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-400">
        WORKSPACE
      </p>
      <nav aria-label="应用导航" className="flex flex-wrap gap-1 lg:flex-col">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${pathname === item.href ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            <span aria-hidden="true" className="w-5 text-center text-lg">
              {item.symbol}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6 space-y-4 lg:mt-auto">
        <div className="rounded-xl border border-slate-200 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-slate-300" />
            Local Connector
          </div>
          <p className="mt-2 text-slate-400">Disconnected · 尚未连接</p>
        </div>
        <div className="flex items-center gap-3 px-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">
            LC
          </span>
          <div>
            <p className="text-sm font-semibold">
              林晨{" "}
              <span className="text-xs font-normal text-slate-400">
                Mock User
              </span>
            </p>
            <p className="text-xs text-slate-400">个人工作空间 · 演示</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
