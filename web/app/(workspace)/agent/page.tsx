import { AgentWorkspace } from "@/components/agent-workspace";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; session?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims.sub === "string") userId = data.claims.sub;
  } catch {
    // An unverified identity must not reuse the previous account's chat component.
  }
  if (!userId) redirect("/login");
  // A verified account change remounts the chat and invalidates its in-flight requests.
  const sessionKey = `${userId}:${params.session ?? (params.new === "1" ? "new" : "default")}`;
  return (
    <AgentWorkspace sessionKey={sessionKey} />
  );
}
