import { diagnoseExecutionDatabase } from "@/lib/agent/execution-store";
import { requireUserId } from "@/lib/ai/http";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const expectedSourceSha = "9f683c554874e00972299213b1cdcbb07aaa3601";

export async function GET(): Promise<Response> {
  try {
    const userId = await requireUserId();
    const expectedDeploymentSha = process.env.AGENT_DIAGNOSTIC_EXPECTED_SHA;
    const allowedUserId = process.env.AGENT_DIAGNOSTIC_USER_ID;
    if (!allowedUserId || userId !== allowedUserId
      || process.env.VERCEL_ENV !== "preview"
      || !expectedDeploymentSha || !/^[0-9a-f]{40}$/u.test(expectedDeploymentSha)
      || expectedDeploymentSha === expectedSourceSha
      || process.env.VERCEL_GIT_COMMIT_SHA !== expectedDeploymentSha) {
      return new Response(null, { status: 404, headers });
    }
    return Response.json(await diagnoseExecutionDatabase(), { headers });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
