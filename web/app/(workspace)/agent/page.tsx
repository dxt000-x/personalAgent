import { AgentWorkspace } from "@/components/agent-workspace";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; session?: string }>;
}) {
  const params = await searchParams;
  const isNew = params.new === "1";
  return (
    <AgentWorkspace
      key={isNew ? `new-${params.session ?? "initial"}` : "demo"}
      isNew={isNew}
    />
  );
}
