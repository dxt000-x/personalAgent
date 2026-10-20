import { diagnoseExecutionDatabase } from "@/lib/agent/execution-store";
import { requireUserId } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const targetBranch = "feat/agent-planning-mvp";
const shaPattern = /^[0-9a-f]{40}$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(): Promise<Response> {
  try {
    const userId = await requireUserId();
    const allowedUserId = process.env.AGENT_DIAGNOSTIC_USER_ID;
    const expectedSha = process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA;
    if (!allowedUserId || !userIdPattern.test(allowedUserId) || userId !== allowedUserId
      || process.env.VERCEL_ENV !== "preview"
      || process.env.VERCEL_GIT_COMMIT_REF !== targetBranch
      || !expectedSha || !shaPattern.test(expectedSha)
      || process.env.VERCEL_GIT_COMMIT_SHA !== expectedSha) {
      return new Response(null, { status: 404, headers });
    }
    return Response.json(await diagnoseExecutionDatabase(), { headers });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
