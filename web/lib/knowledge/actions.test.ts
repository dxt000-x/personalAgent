import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withKnowledgeActions } from "./actions";
import type { KnowledgeDocument } from "./types";

const now = Date.parse("2026-11-08T12:00:00Z");
const row = { status: "processing", updated_at: "2026-11-08T11:50:00Z" } as KnowledgeDocument;
describe("server knowledge action hints", () => {
  it("matches the existing SQL strict ten-minute claim boundary", () => {
    const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/20261009120000_create_knowledge_base.sql"), "utf8");
    expect(sql).toContain("v_doc.updated_at < pg_catalog.now() - interval '10 minutes'");
    expect(withKnowledgeActions(row, now).processing_action).toBeNull();
    expect(withKnowledgeActions(row, now + 1).processing_action).toBe("recover");
    expect(withKnowledgeActions(row, now - 1).processing_action).toBeNull();
  });
  it("fails closed on missing or invalid timestamps and does not change task generation", () => {
    for (const updated_at of ["invalid", "", "2026-11-09T00:00:00Z"]) {
      expect(withKnowledgeActions({ ...row, updated_at }, now).processing_action).toBeNull();
    }
    const input = { ...row, processing_generation: 3 };
    expect(withKnowledgeActions(input, now + 1).processing_generation).toBe(3);
    expect(input.processing_action).toBeUndefined();
  });
  it("only offers immediate retry for temporary failures, never uploading or deleting", () => {
    for (const status of ["uploading", "ready", "deleting"] as const) {
      expect(withKnowledgeActions({ ...row, status }, now).processing_action).toBeNull();
    }
    expect(withKnowledgeActions({ ...row, status: "failed", failure_kind: "temporary" }, now).processing_action).toBe("retry");
    expect(withKnowledgeActions({ ...row, status: "failed", failure_kind: "invalid_file" }, now).processing_action).toBeNull();
  });
});
