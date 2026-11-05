-- Local-only fixture. Never run this against a linked/production project.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'agent_execution_writer_login'
  ) then
    create role agent_execution_writer_login login inherit;
  end if;
end;
$$;

alter role agent_execution_writer_login inherit;
grant agent_execution_writer to agent_execution_writer_login;

insert into agent_private.execution_authorizations (
  jti, user_id, plan_hash, tool, expires_at, state,
  issued_at, started_at, finished_at, replay_rejected_count, last_replay_at
) values
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('a', 64),
  'read_app_status',
  pg_catalog.now() - interval '1 day',
  'succeeded',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '2 days' + interval '1 second',
  pg_catalog.now() - interval '2 days' + interval '2 seconds',
  1,
  pg_catalog.now() - interval '2 days' + interval '3 seconds'
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  repeat('b', 64),
  'read_app_status',
  pg_catalog.now() - interval '1 day',
  'succeeded',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '2 days' + interval '1 second',
  pg_catalog.now() - interval '2 days' + interval '2 seconds',
  1,
  pg_catalog.now() - interval '2 days' + interval '3 seconds'
);

insert into agent_private.execution_events (
  jti, user_id, tool, event, error_code, occurred_at
) values
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'read_app_status', 'issued', null,
  pg_catalog.now() - interval '2 days'
),
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'read_app_status', 'started', null,
  pg_catalog.now() - interval '2 days' + interval '1 second'
),
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'read_app_status', 'succeeded', null,
  pg_catalog.now() - interval '2 days' + interval '2 seconds'
),
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'read_app_status', 'replay_rejected', 'REPLAY_REJECTED',
  pg_catalog.now() - interval '2 days' + interval '3 seconds'
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'read_app_status', 'issued', null,
  pg_catalog.now() - interval '2 days'
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'read_app_status', 'started', null,
  pg_catalog.now() - interval '2 days' + interval '1 second'
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'read_app_status', 'succeeded', null,
  pg_catalog.now() - interval '2 days' + interval '2 seconds'
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'read_app_status', 'replay_rejected', 'REPLAY_REJECTED',
  pg_catalog.now() - interval '2 days' + interval '3 seconds'
);
