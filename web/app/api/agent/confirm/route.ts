import { issueExecutionAuthorization, verifyAuthorization } from "@/lib/agent/execution-authorization";
import { AIGatewayError } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { readJsonBody } from "@/lib/ai/request";
import { parseAgentPlanText } from "@/lib/agent/planning";
import { ExecutionStoreError, persistExecutionAuthorization } from "@/lib/agent/execution-store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let signingConfigFailed = false;
  try {
    const userId = await requireUserId();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).length !== 2 || !Object.hasOwn(body, "planAuthorization") || !Object.hasOwn(body, "plan")) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    const submittedPlan = (body as { plan: unknown }).plan;
    const plan = typeof submittedPlan === "object" && submittedPlan !== null
      ? parseAgentPlanText(JSON.stringify(submittedPlan)) : null;
    if (!plan || !verifyAuthorization((body as { planAuthorization: unknown }).planAuthorization, userId, "plan", plan)) {
      throw new AIGatewayError("INVALID_REQUEST");
    }
    const authorization = issueExecutionAuthorization(userId, plan);
    if (!authorization) {
      signingConfigFailed = true;
      throw new AIGatewayError("EXECUTION_UNAVAILABLE");
    }
    await persistExecutionAuthorization(userId, {
      jti: authorization.jti, planHash: authorization.planHash, expiresAt: authorization.expiresAt,
    });
    return aiJson({ authorization: authorization.token });
  } catch (error) {
    if (!(error instanceof AIGatewayError) || error.code === "EXECUTION_UNAVAILABLE") {
      const stage = error instanceof ExecutionStoreError ? error.stage : signingConfigFailed ? "signing" : "unexpected";
      const category = error instanceof ExecutionStoreError ? error.category : signingConfigFailed ? "invalid_config" : "unexpected";
      console.info(JSON.stringify({ event: "agent_confirm_failure", stage, category }));
    }
    return aiErrorResponse(error instanceof AIGatewayError ? error : new AIGatewayError("EXECUTION_UNAVAILABLE"));
  }
}
