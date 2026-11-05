import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationRoot = resolve(process.cwd(), "../supabase/migrations");
const sql = readFileSync(resolve(migrationRoot, "20261017120000_create_agent_execution_audit.sql"), "utf8");
const readAppStatusSql = readFileSync(resolve(migrationRoot, "20261103071026_enable_read_app_status_execution.sql"), "utf8");
const retireReadAppStatusSql = readFileSync(resolve(migrationRoot, "20261105120000_retire_read_app_status_execution.sql"), "utf8");

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
      expect(sql).toContain(`grant execute on function agent_private.${name}`);
    }
    expect(sql).toMatch(/grant execute on function agent_private\.[^(]+\([^;]+to agent_execution_writer/iu);
    expect(sql).not.toMatch(/grant execute on function agent_private\.[^(]+\([^;]+to authenticated/iu);
    expect(sql).not.toMatch(/(token|secret|plan_content|message_content)\s+(?:text|jsonb)/iu);
  });

  it("restores the migration version already recorded in the database", () => {
    expect(readAppStatusSql).toContain("p_tool is distinct from 'read_app_status'");
    expect(readAppStatusSql).toContain("check (tool in ('read_current_time', 'read_app_status'))");
    expect(readAppStatusSql).toContain("create function agent_private.issue_execution_authorization");
    expect(readAppStatusSql).toContain("create function agent_private.consume_execution_authorization");
  });

  it("retires read_app_status execution without deleting historical audit data", () => {
    expect(retireReadAppStatusSql).toContain("revoke all on function agent_private.issue_execution_authorization");
    expect(retireReadAppStatusSql).toContain("revoke all on function agent_private.consume_execution_authorization");
    expect(retireReadAppStatusSql).toContain("agent_execution_writer");
    expect(retireReadAppStatusSql).toContain("pg_catalog.to_regprocedure");
    expect(retireReadAppStatusSql).not.toMatch(/\b(delete from|truncate|drop table|drop function)\b/iu);
    expect(retireReadAppStatusSql).not.toContain("read_current_time");
    expect(retireReadAppStatusSql).not.toContain("finish_execution_authorization");
  });
});
