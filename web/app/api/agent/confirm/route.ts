import { issueExecutionAuthorization, verifyAuthorization } from "@/lib/agent/execution-authorization";
import { AIGatewayError } from "@/lib/ai/errors";
import { aiErrorResponse, aiJson, requireUserId } from "@/lib/ai/http";
import { readJsonBody } from "@/lib/ai/request";
import { parseAgentPlanText } from "@/lib/agent/planning";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
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
    if (!authorization) throw new AIGatewayError("PROVIDER_ERROR");
    return aiJson({ authorization });
  } catch (error) {
    return aiErrorResponse(error instanceof AIGatewayError ? error : new AIGatewayError("PROVIDER_ERROR"));
  }
}
