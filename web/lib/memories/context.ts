import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { MAX_INPUT_CHARACTERS, MAX_MESSAGES } from "@/lib/ai/limits";
import type { ChatMessage, MemoryUsage } from "@/lib/ai/types";
import { formatMemoryContext, MAX_MEMORY_CONTEXT_CHARACTERS, MAX_MEMORY_CONTEXT_ITEMS } from "./context-format";
import { rankMemories, type RankableMemory } from "./rank";
import { memoryCategories } from "./types";

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const memoryQueryTimeoutMs = 2_000;
const maxMemoryCandidates = 200;
type MemoryFailureKind = "timeout" | "database" | "network";

export type RetrievedMemoryContext = {
  systemInstruction?: string;
  metadata: MemoryUsage;
  diagnostic?: MemoryFailureKind;
};

/** Uses the authenticated user's SSR client so RLS remains the final ownership boundary. */
export async function retrievePersonalMemoryContext(
  supabase: SupabaseClient,
  userId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<RetrievedMemoryContext> {
  const conversationCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  const availableCharacters = Math.min(
    MAX_MEMORY_CONTEXT_CHARACTERS,
    Math.max(0, MAX_INPUT_CHARACTERS - conversationCharacters),
  );

  // Providers that represent instructions as a message need one message slot for the system context.
  if (messages.length >= MAX_MESSAGES || availableCharacters === 0) {
    return { metadata: { status: "omitted", used: false, count: 0 } };
  }

  let querySignal: AbortSignal | undefined;
  try {
    const activeSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(memoryQueryTimeoutMs)])
      : AbortSignal.timeout(memoryQueryTimeoutMs);
    querySignal = activeSignal;
    const query = supabase
      .from("memories")
      .select("id,content,category,importance,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(maxMemoryCandidates)
      .abortSignal(activeSignal);
    // Bound this optional read even if a transport fails to settle after abort.
    const { data, error } = await new Promise<Awaited<typeof query>>((resolve, reject) => {
      const onAbort = () => reject(new Error("memory query timeout"));
      activeSignal.addEventListener("abort", onAbort, { once: true });
      query.then(
        (result) => { activeSignal.removeEventListener("abort", onAbort); resolve(result); },
        (failure) => { activeSignal.removeEventListener("abort", onAbort); reject(failure); },
      );
      if (activeSignal.aborted) onAbort();
    });

    if (error || !Array.isArray(data) || data.length > maxMemoryCandidates) {
      return { metadata: { status: "unavailable", used: false, count: 0 }, diagnostic: querySignal.aborted ? "timeout" : "database" };
    }
    if (data.length === 0) {
      return { metadata: { status: "none", used: false, count: 0 } };
    }

    const records: RankableMemory[] = data.flatMap((row) => {
      if (typeof row.id !== "string"
        || typeof row.created_at !== "string"
        || typeof row.updated_at !== "string"
        || !Number.isFinite(Date.parse(row.created_at))
        || !Number.isFinite(Date.parse(row.updated_at))
        || typeof row.content !== "string"
        || typeof row.category !== "string"
        || !memoryCategories.includes(row.category as (typeof memoryCategories)[number])
        || typeof row.importance !== "number"
        || !Number.isInteger(row.importance)
        || row.importance < 1 || row.importance > 5) {
        return [];
      }
      return [{
        id: row.id,
        content: row.content,
        category: row.category as (typeof memoryCategories)[number],
        importance: row.importance,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }];
    });

    if (records.length === 0) {
      return { metadata: { status: "unavailable", used: false, count: 0 } };
    }

    const latestUserMessage = messages.at(-1)?.content ?? "";
    const ranked = rankMemories(records, latestUserMessage, Date.now());
    const formatted = formatMemoryContext(ranked.slice(0, MAX_MEMORY_CONTEXT_ITEMS), availableCharacters);
    if (!formatted.systemInstruction) {
      return { metadata: { status: "omitted", used: false, count: 0 } };
    }

    return {
      systemInstruction: formatted.systemInstruction,
      metadata: { status: "used", used: true, count: formatted.count },
    };
  } catch {
    // Memory is optional context; avoid logging row contents or raw Supabase errors.
    return { metadata: { status: "unavailable", used: false, count: 0 }, diagnostic: querySignal?.aborted ? "timeout" : "network" };
  }
}
