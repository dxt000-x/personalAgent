import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/20261017120000_create_agent_execution_audit.sql"), "utf8");

describe("agent execution audit migration", () => {
  it("keeps authorization and audit rows inaccessible to browser roles", () => {
    expect(sql).toContain("alter table agent_private.execution_authorizations enable row level security");
    expect(sql).toContain("alter table agent_private.execution_events enable row level security");
    expect(sql).toContain("revoke all on schema agent_private from public, anon, authenticated");
    expect(sql).toContain("revoke all on agent_private.execution_authorizations, agent_private.execution_events");
    expect(sql).not.toMatch(/grant (?:select|insert|update|delete) on agent_private\.[^;]+ to authenticated/iu);
  });

  it("gates the tool behind a conditional atomic update and persists replay audit", () => {
    expect(sql).toMatch(/update agent_private\.execution_authorizations[\s\S]*state = 'started'[\s\S]*state = 'issued'[\s\S]*returning state into v_state/iu);
    expect(sql).toContain("expires_at > pg_catalog.now()");
    expect(sql).toContain("replay_rejected_count = replay_rejected_count + 1");
    expect(sql).toContain("'replay_rejected', 'REPLAY_REJECTED'");
    expect(sql).not.toContain("on conflict");
  });

  it("exposes only fixed definer functions to the dedicated writer role", () => {
    expect(sql).toContain("security definer set search_path = ''");
    for (const name of ["issue_execution_authorization", "consume_execution_authorization", "finish_execution_authorization"]) {
      expect(sql).toContain(`create function agent_private.${name}`);
      expect(sql).toMatch(new RegExp(`grant execute on function agent_private\\.${name}\\([^;]+to agent_execution_writer`, "iu"));
      expect(sql).not.toMatch(new RegExp(`grant execute on function agent_private\\.${name}\\([^;]+to authenticated`, "iu"));
    }
    expect(sql).not.toMatch(/(token|secret|plan_content|message_content)\s+(?:text|jsonb)/iu);
  });
});
