-- Retire the experimental read_app_status execution path.
-- Keep historical authorization and event rows intact. The read_current_time
-- signatures and the shared completion function remain available.
begin;

do $$
begin
  if pg_catalog.to_regprocedure(
    'agent_private.issue_execution_authorization(uuid,uuid,text,timestamp with time zone,text)'
  ) is null then
    raise exception 'Expected read_app_status issue function is missing';
  end if;
  if pg_catalog.to_regprocedure(
    'agent_private.consume_execution_authorization(uuid,uuid,text,text)'
  ) is null then
    raise exception 'Expected read_app_status consume function is missing';
  end if;
end;
$$;

-- The login role inherits agent_execution_writer. Revoking the parent role's
-- EXECUTE grants removes the inherited capability without changing membership
-- or the independent read_current_time function grants.
revoke all on function agent_private.issue_execution_authorization(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated, agent_execution_writer;

revoke all on function agent_private.consume_execution_authorization(
  uuid, uuid, text, text
) from public, anon, authenticated, agent_execution_writer;

commit;
