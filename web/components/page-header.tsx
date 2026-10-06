import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="mb-8 flex flex-wrap items-end justify-between gap-5"><div><p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-teal-700">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{description}</p></div>{action}</header>;
}
