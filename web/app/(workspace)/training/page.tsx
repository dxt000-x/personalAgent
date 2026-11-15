import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { KnowledgeTraining } from "@/components/knowledge-training";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function TrainingPage() {
  const client = await createClient(); if (!client) redirect("/login");
  let id = "";
  try { const { data, error } = await client.auth.getClaims(); if (!error && typeof data?.claims.sub === "string") id = data.claims.sub; } catch { /* Authentication fails closed. */ }
  if (!id) redirect("/login");
  return <><PageHeader eyebrow="知识训练" title="知识训练" description="从自己的文档学习、练习和复习，并随时核对原文。" /><KnowledgeTraining key={id} userId={id} /></>;
}
