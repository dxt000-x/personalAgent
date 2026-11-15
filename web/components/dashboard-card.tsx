"use client";

import { useI18n } from "@/components/i18n-provider";

import type { ReactNode } from "react";

export function DashboardCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="panel">
      <p className="text-xs text-slate-400">{t(subtitle)}</p>
      <h2 className="mt-1 mb-5 text-lg font-semibold">{t(title)}</h2>
      {children}
    </section>
  );
}
