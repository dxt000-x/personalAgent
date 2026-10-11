import { PageHeader } from "@/components/page-header";
import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  let userId = "";
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims.sub === "string") userId = data.claims.sub;
  } catch { /* Fail closed on an unavailable identity service. */ }
  if (!userId) redirect("/login");
  return (
    <>
      <PageHeader eyebrow="YOUR KNOWLEDGE, ORGANIZED" title="Knowledge Base · 个人知识库"
        description="上传并管理个人文档，按关键词查找已就绪文档的正文片段。" />
      <KnowledgeWorkspace key={userId} />
    </>
  );
}
