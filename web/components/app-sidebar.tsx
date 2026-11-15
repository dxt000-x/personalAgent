"use client";

import { useI18n, LanguageSwitcher } from "@/components/i18n-provider";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewTaskLink } from "./new-task-link";
import { AccountMenu } from "./account-menu";

const navigation = [
  { href: "/", label: "Dashboard", symbol: "▦" },
  { href: "/agent", label: "Agent", symbol: "✦" },
  { href: "/memory", label: "Memory", symbol: "◇" },
  { href: "/knowledge", label: "Knowledge Base", symbol: "▤" },
  { href: "/training", label: "知识训练", symbol: "◎" },
  { href: "/settings", label: "Settings", symbol: "⚙" },
];

export function AppSidebar({ userEmail }: { userEmail: string }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  return (
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white p-3 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-r lg:border-b-0 lg:p-5"
      onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); } }}>
      <div className="flex items-center justify-between gap-3">
      <Link
        href="/"
        className="flex items-center gap-3 px-2 py-3"
        aria-label={t("Personal AI Assistant 首页")}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-teal-800 text-xl text-white">
          ✦
        </span>
        <span className="text-sm font-bold leading-5">
          Personal AI
          <span className="block font-normal text-slate-500">Assistant</span>
        </span>
      </Link>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen((value) => !value)} className="button-secondary min-h-11 lg:hidden">
        {open ? t("收起导航") : t("展开导航")}
      </button>
      </div>
      <div className="mt-3 px-2"><LanguageSwitcher /></div>
      <div id={menuId} className={`${open ? "flex" : "hidden"} min-h-0 flex-col lg:flex lg:flex-1`}
        onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }}>
      <NewTaskLink className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900">
        <span aria-hidden="true">＋</span> {t("New Task")}</NewTaskLink>
      <p className="mt-8 mb-3 px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-400">
        {t("WORKSPACE")}</p>
      <nav aria-label={t("应用导航")} className="flex flex-col gap-1">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm ${pathname === item.href ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            <span aria-hidden="true" className="w-5 text-center text-lg">
              {item.symbol}
            </span>
            {t(item.label)}
          </Link>
        ))}
      </nav>
      <div className="mt-6 space-y-4 lg:mt-auto">
        <div className="rounded-xl border border-slate-200 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-slate-300" />
            {t("Local Connector")}</div>
          <p className="mt-2 text-slate-400">{t("Disconnected · 尚未连接")}</p>
        </div>
        <AccountMenu email={userEmail} />
      </div>
      </div>
    </aside>
  );
}
