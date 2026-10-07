import { AgentWorkspace } from "@/components/agent-workspace";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; session?: string }>;
}) {
  const params = await searchParams;
  return (
    <AgentWorkspace key={params.session ?? (params.new === "1" ? "new" : "default")} />
  );
}
