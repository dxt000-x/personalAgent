-- Apply only after review in an isolated Supabase project. This migration has
-- not been run against the target project. Never put a login password in SQL.
begin;

create schema knowledge_private;
revoke all on schema knowledge_private from public, anon, authenticated;
create role knowledge_writer nologin;
grant usage on schema knowledge_private to knowledge_writer;

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (
    char_length(file_name) between 1 and 180 and file_name !~ '[[:cntrl:]/\\]'
  ),
  file_type text not null check (file_type in ('pdf', 'txt', 'md')),
  byte_size integer not null check (byte_size between 1 and 4194304),
  storage_path text generated always as (
    user_id::text || '/' || id::text || '/source.' || file_type
  ) stored unique,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed', 'deleting')),
  failure_kind text check (failure_kind in ('invalid_file', 'temporary')),
  processing_generation integer not null default 0 check (processing_generation >= 0),
  chunk_count integer not null default 0 check (chunk_count between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint knowledge_failure_state_check check (
    (status = 'failed' and failure_kind is not null)
    or (status <> 'failed' and failure_kind is null)
  )
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

-- The insert trigger is the final limit even for direct authenticated table
-- inserts. Its advisory lock serializes count/byte checks for the same user.
create table knowledge_private.knowledge_upload_events (
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index knowledge_upload_events_user_time_idx
  on knowledge_private.knowledge_upload_events (user_id, created_at desc);
revoke all on knowledge_private.knowledge_upload_events from public, anon, authenticated, knowledge_writer;
create table knowledge_private.knowledge_process_events (
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index knowledge_process_events_user_time_idx
  on knowledge_private.knowledge_process_events (user_id, created_at desc);
revoke all on knowledge_private.knowledge_process_events from public, anon, authenticated, knowledge_writer;

create function knowledge_private.limit_knowledge_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_bytes bigint; v_hour_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(174954, pg_catalog.hashtext(new.user_id::text));
  select count(*), coalesce(sum(byte_size), 0)
    into v_count, v_bytes from public.knowledge_documents where user_id = new.user_id;
  if v_count >= 100 or v_bytes + new.byte_size > 104857600 then
    raise exception 'KNOWLEDGE_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  select count(*) into v_hour_count from knowledge_private.knowledge_upload_events
    where user_id = new.user_id
      and created_at >= pg_catalog.date_trunc('hour', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  if v_hour_count >= 20 then
    raise exception 'UPLOAD_RATE_LIMITED' using errcode = 'P0001';
  end if;
  delete from knowledge_private.knowledge_upload_events
    where user_id = new.user_id and created_at < pg_catalog.now() - interval '2 days';
  insert into knowledge_private.knowledge_upload_events (user_id) values (new.user_id);
  return new;
end;
$$;
revoke all on function knowledge_private.limit_knowledge_insert() from public, anon, authenticated;
create trigger limit_knowledge_insert before insert on public.knowledge_documents
  for each row execute function knowledge_private.limit_knowledge_insert();

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

create policy "Users can read own knowledge documents"
  on public.knowledge_documents for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create own knowledge documents"
  on public.knowledge_documents for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'uploading'
    and failure_kind is null and processing_generation = 0 and chunk_count = 0);
create policy "Users can read own knowledge chunks"
  on public.knowledge_chunks for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.knowledge_documents, public.knowledge_chunks from public, anon, authenticated, knowledge_writer;
grant select on public.knowledge_documents, public.knowledge_chunks to authenticated;
grant insert (id, user_id, file_name, file_type, byte_size)
  on public.knowledge_documents to authenticated;

-- Processing operations require the separate server-only database login role.
-- They take a verified user ID from Next.js; authenticated JWTs have no
-- EXECUTE privilege, including when sent directly to the Data API.
create function knowledge_private.claim_knowledge_document(p_user_id uuid, p_document_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_doc public.knowledge_documents%rowtype; v_hour_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(174955, pg_catalog.hashtext(p_user_id::text));
  select * into v_doc from public.knowledge_documents
    where id = p_document_id and user_id = p_user_id for update;
  if not found then return 0; end if;
  if not (v_doc.status = 'uploading'
    or (v_doc.status = 'failed' and v_doc.failure_kind = 'temporary')
    or (v_doc.status = 'processing' and v_doc.updated_at < pg_catalog.now() - interval '10 minutes'))
  then return 0; end if;
  if not exists (select 1 from storage.objects
    where bucket_id = 'knowledge-files' and name = v_doc.storage_path) then return -1; end if;
  select count(*) into v_hour_count from knowledge_private.knowledge_process_events
    where user_id = p_user_id
      and created_at >= pg_catalog.date_trunc('hour', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
  if v_hour_count >= 60 then return -2; end if;
  delete from knowledge_private.knowledge_process_events
    where user_id = p_user_id and created_at < pg_catalog.now() - interval '2 days';
  insert into knowledge_private.knowledge_process_events (user_id) values (p_user_id);
  update public.knowledge_documents
    set status = 'processing', failure_kind = null,
      processing_generation = processing_generation + 1, updated_at = pg_catalog.now()
    where id = p_document_id and user_id = p_user_id
    returning processing_generation into v_doc.processing_generation;
  return v_doc.processing_generation;
end;
$$;

create function knowledge_private.complete_knowledge_document(
  p_user_id uuid, p_document_id uuid, p_generation integer, p_chunks jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_index integer; v_content text;
begin
  perform 1 from public.knowledge_documents
    where id = p_document_id and user_id = p_user_id and status = 'processing'
      and processing_generation = p_generation for update;
  if not found then return false; end if;
  if p_chunks is null or pg_catalog.jsonb_typeof(p_chunks) <> 'array' then return false; end if;
  v_count := pg_catalog.jsonb_array_length(p_chunks);
  if v_count < 1 or v_count > 200 then return false; end if;
  delete from public.knowledge_chunks where document_id = p_document_id and user_id = p_user_id;
  for v_index in 0..v_count - 1 loop
    if pg_catalog.jsonb_typeof(p_chunks -> v_index) <> 'string' then
      raise exception 'INVALID_CHUNK' using errcode = '22023';
    end if;
    v_content := p_chunks ->> v_index;
    if pg_catalog.char_length(v_content) < 1 or pg_catalog.char_length(v_content) > 1200 then
      raise exception 'INVALID_CHUNK' using errcode = '22023';
    end if;
    insert into public.knowledge_chunks (document_id, user_id, chunk_index, content)
      values (p_document_id, p_user_id, v_index, v_content);
  end loop;
  update public.knowledge_documents
    set status = 'ready', chunk_count = v_count, updated_at = pg_catalog.now()
    where id = p_document_id and user_id = p_user_id;
  return true;
end;
$$;

create function knowledge_private.fail_knowledge_document(
  p_user_id uuid, p_document_id uuid, p_generation integer, p_failure_kind text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_failure_kind not in ('invalid_file', 'temporary') then return false; end if;
  update public.knowledge_documents
    set status = 'failed', failure_kind = p_failure_kind, updated_at = pg_catalog.now()
    where id = p_document_id and user_id = p_user_id and status = 'processing'
      and processing_generation = p_generation;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function knowledge_private.mark_knowledge_deleting(p_user_id uuid, p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.knowledge_documents
    set status = 'deleting', failure_kind = null,
      processing_generation = processing_generation + 1, updated_at = pg_catalog.now()
    where id = p_document_id and user_id = p_user_id and status <> 'deleting';
  get diagnostics v_count = row_count;
  if v_count = 1 then return true; end if;
  return exists (select 1 from public.knowledge_documents
    where id = p_document_id and user_id = p_user_id and status = 'deleting');
end;
$$;

create function knowledge_private.finish_knowledge_deletion(p_user_id uuid, p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  select storage_path into v_path from public.knowledge_documents
    where id = p_document_id and user_id = p_user_id and status = 'deleting' for update;
  if v_path is null then return false; end if;
  if exists (select 1 from storage.objects
    where bucket_id = 'knowledge-files' and name = v_path) then return false; end if;
  delete from public.knowledge_documents
    where id = p_document_id and user_id = p_user_id and status = 'deleting';
  return true;
end;
$$;

revoke all on all functions in schema knowledge_private from public, anon, authenticated;
grant execute on function knowledge_private.claim_knowledge_document(uuid, uuid) to knowledge_writer;
grant execute on function knowledge_private.complete_knowledge_document(uuid, uuid, integer, jsonb) to knowledge_writer;
grant execute on function knowledge_private.fail_knowledge_document(uuid, uuid, integer, text) to knowledge_writer;
grant execute on function knowledge_private.mark_knowledge_deleting(uuid, uuid) to knowledge_writer;
grant execute on function knowledge_private.finish_knowledge_deletion(uuid, uuid) to knowledge_writer;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-files', 'knowledge-files', false, 4194304,
  array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from storage.buckets
    where id = 'knowledge-files' and public = false and file_size_limit = 4194304
      and allowed_mime_types = array['application/pdf', 'text/plain', 'text/markdown']::text[]) then
    raise exception 'knowledge-files bucket has unexpected privacy or upload restrictions';
  end if;
end;
$$;

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
