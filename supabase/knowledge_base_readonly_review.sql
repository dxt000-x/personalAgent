-- Read-only review after the migration AND dedicated login role are created.
-- Run in an isolated Supabase SQL Editor first. No document contents or keys.

select n.nspname as function_schema, p.proname as function_name,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('knowledge_writer_login', p.oid, 'EXECUTE') as writer_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where p.proname in ('claim_knowledge_document', 'complete_knowledge_document',
  'fail_knowledge_document', 'mark_knowledge_deleting', 'finish_knowledge_deletion')
order by p.proname;

select has_schema_privilege('authenticated', 'knowledge_private', 'USAGE') as authenticated_private_usage,
  has_schema_privilege('knowledge_writer_login', 'knowledge_private', 'USAGE') as writer_private_usage,
  has_table_privilege('knowledge_writer_login', 'public.knowledge_documents', 'SELECT') as writer_direct_document_select,
  has_table_privilege('knowledge_writer_login', 'public.knowledge_chunks', 'INSERT') as writer_direct_chunk_insert;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('knowledge_documents', 'knowledge_chunks');

select schemaname, tablename, policyname, roles, cmd
from pg_catalog.pg_policies
where (schemaname = 'public' and tablename in ('knowledge_documents', 'knowledge_chunks'))
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'Knowledge%')
order by schemaname, tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'knowledge-files';

select count(*) as public_knowledge_functions
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('claim_knowledge_document',
  'complete_knowledge_document', 'fail_knowledge_document',
  'mark_knowledge_deleting', 'finish_knowledge_deletion');
