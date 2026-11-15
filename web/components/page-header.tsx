"use client";

import { useI18n } from "@/components/i18n-provider";

import { useEffect, type ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  useEffect(() => { document.title = `${t(title)} · PersonalAgent`; }, [t, title]);
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-teal-700">
          {t(eyebrow)}
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl tracking-tight text-slate-900">
          {t(title)}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{t(description)}</p>
      </div>
      {action}
    </header>
  );
}
