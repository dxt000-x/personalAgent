-- Apply only after review. Provision a dedicated agent_execution_writer_login
-- separately; this migration contains no password or login credential.
begin;

create schema agent_private;
revoke all on schema agent_private from public, anon, authenticated;
create role agent_execution_writer nologin;
grant usage on schema agent_private to agent_execution_writer;

create table agent_private.execution_authorizations (
  jti uuid primary key,
  user_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  tool text not null check (tool = 'read_current_time'),
  expires_at timestamptz not null,
  state text not null default 'issued' check (state in ('issued', 'started', 'succeeded', 'failed')),
  issued_at timestamptz not null default pg_catalog.now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text check (error_code in ('TOOL_FAILED', 'AUDIT_UNAVAILABLE')),
  replay_rejected_count integer not null default 0 check (replay_rejected_count >= 0),
  last_replay_at timestamptz
);

create index execution_authorizations_user_issued_idx
  on agent_private.execution_authorizations (user_id, issued_at desc);

create table agent_private.execution_events (
  event_id bigint generated always as identity primary key,
  jti uuid not null references agent_private.execution_authorizations (jti),
  user_id uuid not null,
  tool text not null check (tool = 'read_current_time'),
  event text not null check (event in ('issued', 'started', 'succeeded', 'failed', 'replay_rejected')),
  error_code text check (error_code in ('TOOL_FAILED', 'AUDIT_UNAVAILABLE', 'REPLAY_REJECTED')),
  occurred_at timestamptz not null default pg_catalog.now()
);

create index execution_events_user_time_idx
  on agent_private.execution_events (user_id, occurred_at desc);

alter table agent_private.execution_authorizations enable row level security;
alter table agent_private.execution_events enable row level security;
revoke all on agent_private.execution_authorizations, agent_private.execution_events
  from public, anon, authenticated, agent_execution_writer;
revoke all on sequence agent_private.execution_events_event_id_seq
  from public, anon, authenticated, agent_execution_writer;

-- Only the dedicated server-side role can call these functions. Their definer
-- privileges never become available to authenticated or anonymous Data API clients.
create function agent_private.issue_execution_authorization(
  p_user_id uuid, p_jti uuid, p_plan_hash text, p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_jti is null or p_plan_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= pg_catalog.now()
    -- Allow small app/database clock skew; the signed token still expires at
    -- its exact timestamp and consume checks the stored expiry again.
    or p_expires_at > pg_catalog.now() + interval '60 seconds' then
    return false;
  end if;
  insert into agent_private.execution_authorizations (jti, user_id, plan_hash, tool, expires_at)
  values (p_jti, p_user_id, p_plan_hash, 'read_current_time', p_expires_at);
  insert into agent_private.execution_events (jti, user_id, tool, event)
  values (p_jti, p_user_id, 'read_current_time', 'issued');
  return true;
end;
$$;

create function agent_private.consume_execution_authorization(
  p_user_id uuid, p_jti uuid, p_plan_hash text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
  -- The conditional UPDATE is the single winner gate across all app instances.
  update agent_private.execution_authorizations
    set state = 'started', started_at = pg_catalog.now()
    where user_id = p_user_id and jti = p_jti and plan_hash = p_plan_hash
      and tool = 'read_current_time' and state = 'issued'
      and expires_at > pg_catalog.now()
    returning state into v_state;
  if v_state = 'started' then
    insert into agent_private.execution_events (jti, user_id, tool, event)
    values (p_jti, p_user_id, 'read_current_time', 'started');
    return 'acquired';
  end if;

  select state into v_state from agent_private.execution_authorizations
    where user_id = p_user_id and jti = p_jti and plan_hash = p_plan_hash
      and tool = 'read_current_time' and expires_at > pg_catalog.now();
  if v_state in ('started', 'succeeded', 'failed') then
    update agent_private.execution_authorizations
      set replay_rejected_count = replay_rejected_count + 1,
          last_replay_at = pg_catalog.now()
      where user_id = p_user_id and jti = p_jti;
    insert into agent_private.execution_events (jti, user_id, tool, event, error_code)
    values (p_jti, p_user_id, 'read_current_time', 'replay_rejected', 'REPLAY_REJECTED');
    return 'replay';
  end if;
  return 'missing';
end;
$$;

create function agent_private.finish_execution_authorization(
  p_user_id uuid, p_jti uuid, p_succeeded boolean, p_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_state text;
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
    returning state into v_state;
  if v_state is null then return false; end if;
  insert into agent_private.execution_events (jti, user_id, tool, event, error_code)
  values (p_jti, p_user_id, 'read_current_time', v_state, p_error_code);
  return true;
end;
$$;

revoke all on function agent_private.issue_execution_authorization(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function agent_private.consume_execution_authorization(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function agent_private.finish_execution_authorization(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function agent_private.issue_execution_authorization(uuid, uuid, text, timestamptz)
  to agent_execution_writer;
grant execute on function agent_private.consume_execution_authorization(uuid, uuid, text)
  to agent_execution_writer;
grant execute on function agent_private.finish_execution_authorization(uuid, uuid, boolean, text)
  to agent_execution_writer;

commit;
