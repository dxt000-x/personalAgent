/** Deterministic duplicate key for user-authored Memory content. Not semantic similarity. */
export function normalizeMemoryContent(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** A conservative UI hint; the server only blocks exact normalized duplicates. */
export function isPossibleMemoryDuplicate(left: string, right: string): boolean {
  const a = normalizeMemoryContent(left);
  const b = normalizeMemoryContent(right);
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  return shorter >= 8 && shorter / longer >= 0.75 && (a.includes(b) || b.includes(a));
}
