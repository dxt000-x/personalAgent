import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/20261009120000_create_knowledge_base.sql", import.meta.url), "utf8");

describe("Knowledge migration static safety guard (real grants still require Supabase acceptance)", () => {
  it("keeps all five SECURITY DEFINER operations out of the exposed public schema", () => {
    for (const name of ["claim_knowledge_document", "complete_knowledge_document",
      "fail_knowledge_document", "mark_knowledge_deleting", "finish_knowledge_deletion"]) {
      expect(sql).toContain(`create function knowledge_private.${name}`);
      expect(sql).not.toContain(`create function public.${name}`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function knowledge_private\\.${name}[^;]*to authenticated`, "iu"));
    }
    expect(sql).toContain("revoke all on all functions in schema knowledge_private from public, anon, authenticated");
  });
  it("bounds direct document insertion and private processing in SQL", () => {
    expect(sql).toContain("create trigger limit_knowledge_insert before insert");
    expect(sql).toContain("v_count >= 100");
    expect(sql).toContain("v_bytes + new.byte_size > 104857600");
    expect(sql).toContain("v_hour_count >= 20");
    expect(sql).toContain("v_hour_count >= 60");
    expect(sql).toContain("processing_generation = p_generation");
    expect(sql).toContain("from storage.objects");
  });
});
