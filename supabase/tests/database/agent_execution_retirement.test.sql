create extension if not exists pgtap with schema extensions;

begin;
select extensions.plan(18);

select extensions.ok(not has_function_privilege('agent_execution_writer',
  'agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz,text)', 'EXECUTE'),
  'writer cannot execute retired issue function');
select extensions.ok(not has_function_privilege('agent_execution_writer',
  'agent_private.consume_execution_authorization(uuid,uuid,text,text)', 'EXECUTE'),
  'writer cannot execute retired consume function');
select extensions.ok(not has_function_privilege('agent_execution_writer_login',
  'agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz,text)', 'EXECUTE'),
  'login cannot inherit retired issue function');
select extensions.ok(not has_function_privilege('agent_execution_writer_login',
  'agent_private.consume_execution_authorization(uuid,uuid,text,text)', 'EXECUTE'),
  'login cannot inherit retired consume function');

select extensions.ok(has_function_privilege('agent_execution_writer',
  'agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'writer retains current-time issue function');
select extensions.ok(has_function_privilege('agent_execution_writer',
  'agent_private.consume_execution_authorization(uuid,uuid,text)', 'EXECUTE'),
  'writer retains current-time consume function');
select extensions.ok(has_function_privilege('agent_execution_writer',
  'agent_private.finish_execution_authorization(uuid,uuid,boolean,text)', 'EXECUTE'),
  'writer retains shared completion function');
select extensions.ok(has_function_privilege('agent_execution_writer_login',
  'agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'login retains inherited current-time issue permission');
select extensions.ok(has_function_privilege('agent_execution_writer_login',
  'agent_private.consume_execution_authorization(uuid,uuid,text)', 'EXECUTE'),
  'login retains inherited current-time consume permission');
select extensions.ok(has_function_privilege('agent_execution_writer_login',
  'agent_private.finish_execution_authorization(uuid,uuid,boolean,text)', 'EXECUTE'),
  'login retains inherited completion permission');
select extensions.ok(pg_has_role('agent_execution_writer_login','agent_execution_writer','USAGE'),
  'login membership remains intact');
select extensions.ok(to_regprocedure('agent_private.issue_execution_authorization(uuid,uuid,text,timestamptz,text)') is not null,
  'retired issue function definition is preserved');
select extensions.ok(to_regprocedure('agent_private.consume_execution_authorization(uuid,uuid,text,text)') is not null,
  'retired consume function definition is preserved');

select extensions.is((select count(*) from agent_private.execution_authorizations where tool='read_app_status'),
  2::bigint, 'two historical authorization rows remain');
select extensions.is((select count(*) from agent_private.execution_events where tool='read_app_status'),
  8::bigint, 'eight historical audit events remain');
select extensions.is((select count(*) from agent_private.execution_authorizations where tool='read_app_status' and state='succeeded' and replay_rejected_count=1),
  2::bigint, 'historical authorization state and replay counters remain');
select extensions.is((select count(*) from agent_private.execution_events where tool='read_app_status' and event in ('issued','started','succeeded','replay_rejected')),
  8::bigint, 'historical event types remain');
select extensions.is((select count(distinct jti) from agent_private.execution_events where tool='read_app_status'),
  2::bigint, 'historical events remain associated with two JTIs');

select * from extensions.finish();
rollback;
