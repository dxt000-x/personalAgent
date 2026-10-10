-- Read-only catalog audit after migration and dedicated login setup.
-- Run in an isolated Supabase SQL Editor first. Review every unexpected row.

select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole,
  rolcreatedb, rolreplication, rolinherit
from pg_catalog.pg_roles
where rolname in ('knowledge_writer_login', 'knowledge_writer');

-- Transitive memberships. PUBLIC is not a membership; it is audited below.
with recursive memberships as (
  select m.member, m.roleid, m.admin_option,
    pg_catalog.to_jsonb(m)->>'inherit_option' as inherit_option,
    pg_catalog.to_jsonb(m)->>'set_option' as set_option,
    array[m.member, m.roleid] as path
  from pg_catalog.pg_auth_members m
  where m.member = 'knowledge_writer_login'::pg_catalog.regrole
  union all
  select m.member, m.roleid, m.admin_option,
    pg_catalog.to_jsonb(m)->>'inherit_option', pg_catalog.to_jsonb(m)->>'set_option',
    memberships.path || m.roleid
  from memberships
  join pg_catalog.pg_auth_members m on m.member = memberships.roleid
  where not m.roleid = any(memberships.path)
)
select member::pg_catalog.regrole::text as member_role,
  roleid::pg_catalog.regrole::text as inherited_role,
  admin_option, inherit_option, set_option
from memberships order by member_role, inherited_role;

select pg_catalog.current_database() as database_name,
  pg_catalog.has_database_privilege('knowledge_writer_login', pg_catalog.current_database(), 'CONNECT') as can_connect,
  pg_catalog.has_database_privilege('knowledge_writer_login', pg_catalog.current_database(), 'CREATE') as can_create,
  pg_catalog.has_database_privilege('knowledge_writer_login', pg_catalog.current_database(), 'TEMP') as can_create_temp;

-- Effective rights include direct, inherited, and PUBLIC grants.
select n.nspname as schema_name,
  pg_catalog.has_schema_privilege('knowledge_writer_login', n.oid, 'USAGE') as can_use,
  pg_catalog.has_schema_privilege('knowledge_writer_login', n.oid, 'CREATE') as can_create
from pg_catalog.pg_namespace n
where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
  and (pg_catalog.has_schema_privilege('knowledge_writer_login', n.oid, 'USAGE')
    or pg_catalog.has_schema_privilege('knowledge_writer_login', n.oid, 'CREATE'))
order by n.nspname;

select n.nspname as schema_name, c.relname as object_name, c.relkind,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'SELECT') as can_select,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'INSERT') as can_insert,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'UPDATE') as can_update,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'DELETE') as can_delete,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'TRUNCATE') as can_truncate,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'REFERENCES') as can_reference,
  pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'TRIGGER') as can_trigger
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
  and (pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'SELECT')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'INSERT')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'UPDATE')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'DELETE')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'TRUNCATE')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'REFERENCES')
    or pg_catalog.has_table_privilege('knowledge_writer_login', c.oid, 'TRIGGER'))
order by n.nspname, c.relname;

select n.nspname as schema_name, c.relname as sequence_name,
  pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'USAGE') as can_use,
  pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'SELECT') as can_select,
  pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'UPDATE') as can_update
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'S' and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
  and (pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'USAGE')
    or pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'SELECT')
    or pg_catalog.has_sequence_privilege('knowledge_writer_login', c.oid, 'UPDATE'))
order by n.nspname, c.relname;

-- Non-system callable routines may expose more than the intended five.
select n.nspname as schema_name, p.oid::pg_catalog.regprocedure::text as routine,
  p.prosecdef as security_definer
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
  and pg_catalog.has_function_privilege('knowledge_writer_login', p.oid, 'EXECUTE')
order by n.nspname, routine;

-- Explicit/implicit PUBLIC privileges on non-system objects.
select 'schema' as object_kind, n.nspname as object_name, a.privilege_type
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,
  pg_catalog.acldefault('n', n.nspowner))) a
where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and a.grantee = 0
union all
select 'relation', n.nspname || '.' || c.relname, a.privilege_type
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,
  pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and a.grantee = 0
union all
select 'routine', n.nspname || '.' || p.oid::pg_catalog.regprocedure::text, a.privilege_type
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,
  pg_catalog.acldefault('f', p.proowner))) a
where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and a.grantee = 0
order by object_kind, object_name, privilege_type;

select r.rolname as object_owner, coalesce(n.nspname, '<all schemas>') as schema_name,
  d.defaclobjtype as object_type,
  case when a.grantee = 0 then 'PUBLIC' else a.grantee::pg_catalog.regrole::text end as grantee,
  a.privilege_type
from pg_catalog.pg_default_acl d
join pg_catalog.pg_roles r on r.oid = d.defaclrole
left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) a
where n.nspname is null or (n.nspname <> 'information_schema' and n.nspname !~ '^pg_')
order by object_owner, schema_name, object_type, grantee, privilege_type;

-- Expected five SECURITY DEFINER routines: authenticated=false, writer=true.
select n.nspname as function_schema, p.proname as function_name,
  p.prosecdef as security_definer,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  pg_catalog.has_function_privilege('knowledge_writer_login', p.oid, 'EXECUTE') as writer_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where p.proname in ('claim_knowledge_document', 'complete_knowledge_document',
  'fail_knowledge_document', 'mark_knowledge_deleting', 'finish_knowledge_deletion')
order by p.proname;

select pg_catalog.has_schema_privilege('authenticated', 'knowledge_private', 'USAGE') as authenticated_private_usage,
  pg_catalog.has_schema_privilege('knowledge_writer_login', 'knowledge_private', 'USAGE') as writer_private_usage,
  pg_catalog.has_table_privilege('knowledge_writer_login', 'public.knowledge_documents', 'SELECT') as writer_direct_document_select,
  pg_catalog.has_table_privilege('knowledge_writer_login', 'public.knowledge_chunks', 'INSERT') as writer_direct_chunk_insert;

select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('knowledge_documents', 'knowledge_chunks');

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in ('knowledge_documents', 'knowledge_chunks')
order by tablename, policyname;

-- ALL storage.objects policies, irrespective of name. A permissive policy
-- applicable to authenticated may OR-open knowledge-files despite narrow
-- Knowledge policies. Inspect every true role-applicability row.
-- polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL.
select p.polname as policy_name, p.polpermissive as permissive, p.polcmd as command,
  array(select case when r.role_oid = 0 then 'PUBLIC'
    else r.role_oid::pg_catalog.regrole::text end
    from pg_catalog.unnest(p.polroles) as r(role_oid)) as roles,
  exists (select 1 from pg_catalog.unnest(p.polroles) as r(role_oid)
    where case when r.role_oid = 0 then true
      else pg_catalog.pg_has_role('authenticated'::pg_catalog.regrole::oid,
        r.role_oid, 'USAGE') end) as inherited_by_authenticated,
  exists (select 1 from pg_catalog.unnest(p.polroles) as r(role_oid)
    where case when r.role_oid = 0 then true
      else pg_catalog.pg_has_role('authenticated'::pg_catalog.regrole::oid,
        r.role_oid, 'MEMBER') end) as reachable_by_authenticated_membership,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects'
order by p.polcmd, p.polname;

select c.relrowsecurity as storage_rls_enabled, c.relforcerowsecurity as storage_rls_forced
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'knowledge-files';

select count(*) as public_knowledge_functions
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('claim_knowledge_document',
  'complete_knowledge_document', 'fail_knowledge_document',
  'mark_knowledge_deleting', 'finish_knowledge_deletion');
