-- Review in an isolated Supabase project before applying to the target project.
-- Uploads use the authenticated user's JWT; there is no service_role path.
begin;

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (
    char_length(file_name) between 1 and 180
    and file_name !~ '[[:cntrl:]/\\]'
  ),
  file_type text not null check (file_type in ('pdf', 'txt', 'md')),
  byte_size integer not null check (byte_size between 1 and 4194304),
  storage_path text generated always as (
    user_id::text || '/' || id::text || '/source.' || file_type
  ) stored unique,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed', 'deleting')),
  chunk_count integer not null default 0 check (chunk_count between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index knowledge_documents_user_created_idx
  on public.knowledge_documents (user_id, created_at desc);

create table public.knowledge_chunks (
  document_id uuid not null,
  user_id uuid not null,
  chunk_index integer not null check (chunk_index between 0 and 199),
  content text not null check (char_length(content) between 1 and 1200),
  primary key (document_id, chunk_index),
  foreign key (document_id, user_id)
    references public.knowledge_documents (id, user_id) on delete cascade
);

create index knowledge_chunks_user_document_idx
  on public.knowledge_chunks (user_id, document_id, chunk_index);

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

create policy "Users can read own knowledge documents"
  on public.knowledge_documents for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create own knowledge documents"
  on public.knowledge_documents for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'uploading' and chunk_count = 0);
create policy "Users can read own knowledge chunks"
  on public.knowledge_chunks for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.knowledge_documents, public.knowledge_chunks from public, anon, authenticated;
grant select on public.knowledge_documents, public.knowledge_chunks to authenticated;
grant insert (id, user_id, file_name, file_type, byte_size)
  on public.knowledge_documents to authenticated;

-- The five transitions are bounded and always derive ownership from auth.uid().
-- A direct RPC call can only change the caller's own records.
create function public.claim_knowledge_document(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.knowledge_documents
    set status = 'processing', updated_at = pg_catalog.now()
    where id = p_document_id and user_id = auth.uid()
      and (status = 'uploading'
        or (status = 'processing' and updated_at < pg_catalog.now() - interval '10 minutes'));
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function public.complete_knowledge_document(p_document_id uuid, p_chunks jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_index integer;
  v_content text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform 1 from public.knowledge_documents
    where id = p_document_id and user_id = v_user_id and status = 'processing'
    for update;
  if not found then return false; end if;
  if p_chunks is null or pg_catalog.jsonb_typeof(p_chunks) <> 'array' then return false; end if;
  v_count := pg_catalog.jsonb_array_length(p_chunks);
  if v_count < 1 or v_count > 200 then return false; end if;
  -- A stale claim can be retried; the whole function runs in one transaction.
  delete from public.knowledge_chunks
    where document_id = p_document_id and user_id = v_user_id;
  for v_index in 0..v_count - 1 loop
    if pg_catalog.jsonb_typeof(p_chunks -> v_index) <> 'string' then
      raise exception 'INVALID_CHUNK' using errcode = '22023';
    end if;
    v_content := p_chunks ->> v_index;
    if pg_catalog.char_length(v_content) < 1 or pg_catalog.char_length(v_content) > 1200 then
      raise exception 'INVALID_CHUNK' using errcode = '22023';
    end if;
    insert into public.knowledge_chunks (document_id, user_id, chunk_index, content)
      values (p_document_id, v_user_id, v_index, v_content);
  end loop;
  update public.knowledge_documents
    set status = 'ready', chunk_count = v_count, updated_at = pg_catalog.now()
    where id = p_document_id and user_id = v_user_id;
  return true;
end;
$$;

create function public.fail_knowledge_document(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.knowledge_documents
    set status = 'failed', updated_at = pg_catalog.now()
    where id = p_document_id and user_id = auth.uid() and status = 'processing';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function public.mark_knowledge_deleting(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.knowledge_documents
    set status = 'deleting', updated_at = pg_catalog.now()
    where id = p_document_id and user_id = auth.uid() and status <> 'deleting';
  get diagnostics v_count = row_count;
  if v_count = 1 then return true; end if;
  return exists (select 1 from public.knowledge_documents
    where id = p_document_id and user_id = auth.uid() and status = 'deleting');
end;
$$;

create function public.finish_knowledge_deletion(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select storage_path into v_path from public.knowledge_documents
    where id = p_document_id and user_id = auth.uid() and status = 'deleting'
    for update;
  if v_path is null then return false; end if;
  -- Never remove metadata while the private Storage object still exists.
  if exists (select 1 from storage.objects
    where bucket_id = 'knowledge-files' and name = v_path) then return false; end if;
  delete from public.knowledge_documents
    where id = p_document_id and user_id = auth.uid() and status = 'deleting';
  return true;
end;
$$;

revoke all on function public.claim_knowledge_document(uuid) from public, anon, authenticated;
revoke all on function public.complete_knowledge_document(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_knowledge_document(uuid) from public, anon, authenticated;
revoke all on function public.mark_knowledge_deleting(uuid) from public, anon, authenticated;
revoke all on function public.finish_knowledge_deletion(uuid) from public, anon, authenticated;
grant execute on function public.claim_knowledge_document(uuid) to authenticated;
grant execute on function public.complete_knowledge_document(uuid, jsonb) to authenticated;
grant execute on function public.fail_knowledge_document(uuid) to authenticated;
grant execute on function public.mark_knowledge_deleting(uuid) to authenticated;
grant execute on function public.finish_knowledge_deletion(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-files', 'knowledge-files', false, 4194304,
  array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from storage.buckets
    where id = 'knowledge-files' and public = false
      and file_size_limit = 4194304
      and allowed_mime_types = array['application/pdf', 'text/plain', 'text/markdown']::text[]) then
    raise exception 'knowledge-files bucket has unexpected privacy or upload restrictions';
  end if;
end;
$$;

-- Storage itself already has RLS. Policies are scoped to this bucket and a
-- database record owned by the same authenticated user.
create policy "Knowledge upload for own pending document"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge-files' and exists (
    select 1 from public.knowledge_documents d
      where d.user_id = auth.uid() and d.storage_path = name and d.status = 'uploading'
  ));
create policy "Knowledge read own file"
  on storage.objects for select to authenticated
  using (bucket_id = 'knowledge-files' and exists (
    select 1 from public.knowledge_documents d
      where d.user_id = auth.uid() and d.storage_path = name
  ));
create policy "Knowledge remove own failed or deleting file"
  on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge-files' and exists (
    select 1 from public.knowledge_documents d
      where d.user_id = auth.uid() and d.storage_path = name
        and d.status in ('failed', 'deleting')
  ));

commit;
