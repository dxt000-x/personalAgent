import { AIGatewayError } from "@/lib/ai/errors";
import { runAiGateway } from "@/lib/ai/gateway";
import { aiErrorResponse, aiJson, requireAuthenticatedUser } from "@/lib/ai/http";
import { containsSensitiveMaterial, extractionInstruction, parseMemoryCandidates, validateCandidateRequest } from "@/lib/ai/memory-candidates";
import { readJsonBody } from "@/lib/ai/request";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase, userId } = await requireAuthenticatedUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new AIGatewayError("INVALID_REQUEST");
    const input = validateCandidateRequest(await readJsonBody(request));
    // Do not send probable credentials to a second model call, including in Auto mode.
    if (containsSensitiveMaterial(input.message)) return aiJson({ candidates: [] });

    const result = await runAiGateway(supabase, {
      provider: input.provider,
      routingPreference: input.routingPreference,
      messages: [{ role: "user", content: input.message }],
      systemInstruction: extractionInstruction,
    });
    const parsed = parseMemoryCandidates(result.text, []);
    if (parsed.length === 0) return aiJson({ candidates: [] });

    // Only the authenticated user's rows are read. Existing contents never enter the model prompt.
    const { data, error } = await supabase.from("memories")
      .select("content")
      .eq("user_id", userId)
      .limit(1000)
      .abortSignal(AbortSignal.timeout(2000));
    if (error || !Array.isArray(data)) throw new AIGatewayError("PROVIDER_ERROR");
    const contents = data.flatMap((row) => typeof row.content === "string" ? [row.content] : []);
    return aiJson({ candidates: parseMemoryCandidates(result.text, contents) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
