-- Forward-only extension of the existing private Agent audit boundary.
-- The old time-tool signatures remain callable during the Web rollout.
begin;

alter table agent_private.execution_authorizations
  drop constraint execution_authorizations_tool_check;
alter table agent_private.execution_authorizations
  add constraint execution_authorizations_tool_check
  check (tool in ('read_current_time', 'read_app_status'));
alter table agent_private.execution_events
  drop constraint execution_events_tool_check;
alter table agent_private.execution_events
  add constraint execution_events_tool_check
  check (tool in ('read_current_time', 'read_app_status'));

create function agent_private.issue_execution_authorization(
  p_user_id uuid, p_jti uuid, p_plan_hash text, p_expires_at timestamptz, p_tool text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_jti is null or p_plan_hash !~ '^[0-9a-f]{64}$'
    or p_tool is distinct from 'read_app_status'
    or p_expires_at <= pg_catalog.now()
    or p_expires_at > pg_catalog.now() + interval '60 seconds' then
    return false;
  end if;
  insert into agent_private.execution_authorizations (jti, user_id, plan_hash, tool, expires_at)
  values (p_jti, p_user_id, p_plan_hash, p_tool, p_expires_at);
  insert into agent_private.execution_events (jti, user_id, tool, event)
  values (p_jti, p_user_id, p_tool, 'issued');
  return true;
end;
$$;

create function agent_private.consume_execution_authorization(
  p_user_id uuid, p_jti uuid, p_plan_hash text, p_tool text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
  if p_tool is distinct from 'read_app_status' then return 'missing'; end if;
  update agent_private.execution_authorizations
    set state = 'started', started_at = pg_catalog.now()
    where user_id = p_user_id and jti = p_jti and plan_hash = p_plan_hash
      and tool = p_tool and state = 'issued' and expires_at > pg_catalog.now()
    returning state into v_state;
  if v_state = 'started' then
    insert into agent_private.execution_events (jti, user_id, tool, event)
    values (p_jti, p_user_id, p_tool, 'started');
    return 'acquired';
  end if;

  select state into v_state from agent_private.execution_authorizations
    where user_id = p_user_id and jti = p_jti and plan_hash = p_plan_hash
      and tool = p_tool and expires_at > pg_catalog.now();
  if v_state in ('started', 'succeeded', 'failed') then
    update agent_private.execution_authorizations
      set replay_rejected_count = replay_rejected_count + 1,
          last_replay_at = pg_catalog.now()
      where user_id = p_user_id and jti = p_jti and tool = p_tool;
    insert into agent_private.execution_events (jti, user_id, tool, event, error_code)
    values (p_jti, p_user_id, p_tool, 'replay_rejected', 'REPLAY_REJECTED');
    return 'replay';
  end if;
  return 'missing';
end;
$$;

-- The existing completion signature is preserved; events use the stored Tool.
create or replace function agent_private.finish_execution_authorization(
  p_user_id uuid, p_jti uuid, p_succeeded boolean, p_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_state text; v_tool text;
begin
  if p_succeeded is null or (p_succeeded and p_error_code is not null)
    or (not p_succeeded and (p_error_code is null
      or p_error_code not in ('TOOL_FAILED', 'AUDIT_UNAVAILABLE'))) then
    return false;
  end if;
  update agent_private.execution_authorizations
    set state = case when p_succeeded then 'succeeded' else 'failed' end,
        finished_at = pg_catalog.now(), error_code = p_error_code
    where user_id = p_user_id and jti = p_jti and state = 'started'
    returning state, tool into v_state, v_tool;
  if v_state is null then return false; end if;
  insert into agent_private.execution_events (jti, user_id, tool, event, error_code)
  values (p_jti, p_user_id, v_tool, v_state, p_error_code);
  return true;
end;
$$;

revoke all on function agent_private.issue_execution_authorization(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function agent_private.consume_execution_authorization(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function agent_private.issue_execution_authorization(uuid, uuid, text, timestamptz, text)
  to agent_execution_writer;
grant execute on function agent_private.consume_execution_authorization(uuid, uuid, text, text)
  to agent_execution_writer;

commit;
