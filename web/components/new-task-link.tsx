"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function NewTaskLink({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const router = useRouter();
  return (
    <Link
      href="/agent?new=1"
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        // A new query key gives each Agent workspace a fresh in-memory conversation.
        router.push(`/agent?new=1&session=${Date.now()}`);
      }}
    >
      {children}
    </Link>
  );
}
