import { MemoryWorkspace } from "@/components/memory-workspace";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function MemoryPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims.sub === "string") userId = data.claims.sub;
  } catch {
    // An unverified account must not reuse the previous account's Memory component.
  }
  if (!userId) redirect("/login");
  return (
    <>
      <PageHeader
        eyebrow="PERSONAL CONTEXT"
        title="Personal Memory · 个人记忆"
        description="只属于当前登录账号的长期目标、项目与偏好。"
      />
      <MemoryWorkspace key={userId} />
    </>
  );
}
