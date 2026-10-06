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
  return (
    <section className="panel">
      <p className="text-xs text-slate-400">{subtitle}</p>
      <h2 className="mt-1 mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
