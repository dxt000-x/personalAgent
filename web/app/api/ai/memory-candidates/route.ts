import { AIGatewayError } from "@/lib/ai/errors";
import { AIRequestDiagnostics } from "@/lib/ai/diagnostics";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { containsSensitiveMaterial, extractionInstruction, parseMemoryCandidates, validateCandidateRequest } from "@/lib/ai/memory-candidates";
import { readJsonBody } from "@/lib/ai/request";
import { AIRequestDeadline } from "@/lib/ai/request-deadline";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const deadline = new AIRequestDeadline(request.signal);
  const diagnostics = new AIRequestDiagnostics("memory-candidates");
  let finalCode: Parameters<typeof diagnostics.finish>[0] = "SUCCESS";
  try {
    deadline.assertRemaining();
    return await deadline.wait((async () => {
      const { supabase, userId } = await diagnostics.measure("authDurationMs", requireAuthenticatedUser);
      deadline.assertRemaining();
      const input = await diagnostics.measure("validationDurationMs", async () => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
        return validateCandidateRequest(await readJsonBody(request, deadline.signal));
      });
      deadline.assertRemaining();
      // Do not send probable credentials to a second model call, including in Auto mode.
      if (containsSensitiveMaterial(input.message)) return aiJson({ candidates: [] });

      const result = await runAiGateway(supabase, {
        provider: input.provider,
        routingPreference: input.routingPreference,
        messages: [{ role: "user", content: input.message }],
        systemInstruction: extractionInstruction,
        disableThinking: true,
      }, deadline, diagnostics);
      deadline.assertRemaining();
      const parsed = parseMemoryCandidates(result.text, []);
      if (parsed.length === 0) return aiJson({ candidates: [] });

      // Only the authenticated user's rows are read. Existing contents never enter the model prompt.
      const { data, error } = await diagnostics.measure("dedupeDurationMs", async () => supabase.from("memories")
        .select("content")
        .eq("user_id", userId)
        .limit(1000)
        .abortSignal(AbortSignal.any([deadline.signal, AbortSignal.timeout(2000)])));
      deadline.assertRemaining();
      if (error || !Array.isArray(data)) throw new AIGatewayError("PROVIDER_ERROR");
      const contents = data.flatMap((row) => typeof row.content === "string" ? [row.content] : []);
      return aiJson({ candidates: parseMemoryCandidates(result.text, contents) });
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
