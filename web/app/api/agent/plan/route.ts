import { buildPlanningInstruction, MAX_PLAN_TASK_CHARS, parseAgentPlanText } from "@/lib/agent/planning";
import { AIGatewayError } from "@/lib/ai/errors";
import { AIRequestDiagnostics } from "@/lib/ai/diagnostics";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import { AIRequestDeadline } from "@/lib/ai/request-deadline";
import { hasExecutionSigningKey, issuePlanAuthorization } from "@/lib/agent/execution-authorization";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const deadline = new AIRequestDeadline(request.signal);
  const diagnostics = new AIRequestDiagnostics("plan");
  let finalCode: Parameters<typeof diagnostics.finish>[0] = "SUCCESS";
  try {
    deadline.assertRemaining();
    return await deadline.wait((async () => {
      const { supabase, userId } = await diagnostics.measure("authDurationMs", requireAuthenticatedUser);
      deadline.assertRemaining();

      const input = await diagnostics.measure("validationDurationMs", async () => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
        const parsed = validateChatRequest(await readJsonBody(request, deadline.signal));
        if (parsed.knowledge || parsed.messages.length !== 1
          || parsed.messages[0].role !== "user"
          || parsed.messages[0].content.length > MAX_PLAN_TASK_CHARS) {
          throw new AIGatewayError("INVALID_REQUEST");
        }
        return parsed;
      });
      deadline.assertRemaining();
      if (!hasExecutionSigningKey()) throw new AIGatewayError("EXECUTION_UNAVAILABLE");

      const result = await runAiGateway(supabase, {
        provider: input.provider,
        routingPreference: input.routingPreference,
        messages: input.messages,
        systemInstruction: buildPlanningInstruction(),
        openRouterMaxOutputTokens: 2_048,
      }, deadline, diagnostics);
      deadline.assertRemaining();
      const plan = parseAgentPlanText(result.text);
      if (!plan) {
        diagnostics.setFailureKind("plan_invalid_output");
        throw new AIGatewayError("PROVIDER_ERROR");
      }
      const planAuthorization = issuePlanAuthorization(userId, plan);
      if (!planAuthorization) throw new AIGatewayError("EXECUTION_UNAVAILABLE");
      return aiJson({ plan, planAuthorization });
    })());
  } catch (error) {
    const safeError = error instanceof AIGatewayError ? error
      : deadline.remainingMs() === 0 || deadline.signal.aborted
        ? new AIGatewayError("TIMEOUT") : new AIGatewayError("PROVIDER_ERROR");
    finalCode = request.signal.aborted ? "CLIENT_ABORTED" : safeError.code;
    if (!diagnostics.hasFailureOrigin && safeError.code === "TIMEOUT") {
      diagnostics.setFailureOrigin(deadline.abortOrigin ?? "unknown");
    }
    if (!diagnostics.hasFailureKind) {
      if (safeError.code === "TIMEOUT") {
        const origin = deadline.abortOrigin;
        diagnostics.setFailureKind(origin && origin !== "unknown" ? origin : "timeout_source_unknown");
      } else if (safeError.code === "PROVIDER_ERROR") {
        diagnostics.setFailureKind("route_unexpected_error");
      }
    }
    return aiErrorResponse(safeError);
  } finally {
    deadline.close();
    diagnostics.finish(finalCode);
  }
}
