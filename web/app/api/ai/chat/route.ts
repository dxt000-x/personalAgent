import { AIGatewayError } from "@/lib/ai/errors";
import { AIRequestDiagnostics } from "@/lib/ai/diagnostics";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { readJsonBody, validateChatRequest } from "@/lib/ai/request";
import { AIRequestDeadline } from "@/lib/ai/request-deadline";
import type { AIChatResult } from "@/lib/ai/types";
import { retrievePersonalMemoryContext } from "@/lib/memories/context";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const deadline = new AIRequestDeadline(request.signal);
  const diagnostics = new AIRequestDiagnostics("chat");
  let finalCode: Parameters<typeof diagnostics.finish>[0] = "SUCCESS";
  try {
    deadline.assertRemaining();
    return await deadline.wait((async () => {
      const { supabase, userId } = await diagnostics.measure("authDurationMs", requireAuthenticatedUser);
      deadline.assertRemaining();
      const { provider: providerId, routingPreference, messages } = await diagnostics.measure("validationDurationMs", async () => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
        return validateChatRequest(await readJsonBody(request, deadline.signal));
      });
      deadline.assertRemaining();
      const memoryContext = await diagnostics.measure("memoryDurationMs", () =>
        retrievePersonalMemoryContext(supabase, userId, messages, deadline.signal));
      diagnostics.setMemoryFailure(memoryContext.diagnostic);
      deadline.assertRemaining();
      const result = await runAiGateway(supabase, {
        provider: providerId, routingPreference, messages, systemInstruction: memoryContext.systemInstruction,
      }, deadline, diagnostics);
      deadline.assertRemaining();
      return aiJson({ ...result, memory: memoryContext.metadata } satisfies AIChatResult);
    })());
  } catch (error) {
    const safeError = error instanceof AIGatewayError ? error
      : deadline.remainingMs() === 0 || deadline.signal.aborted
        ? new AIGatewayError("TIMEOUT") : new AIGatewayError("PROVIDER_ERROR");
    finalCode = request.signal.aborted ? "CLIENT_ABORTED" : safeError.code;
    return aiErrorResponse(safeError);
  } finally {
    deadline.close();
    diagnostics.finish(finalCode);
  }
}
