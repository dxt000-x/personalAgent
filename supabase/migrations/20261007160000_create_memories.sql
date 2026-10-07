-- Personal Memory storage. Apply once in the Supabase SQL Editor.
-- Row Level Security remains the final ownership boundary for every request.

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null
    check (char_length(btrim(content)) between 1 and 2000),
  category text not null
    check (category in ('preference', 'profile', 'goal', 'work', 'study', 'habit', 'other')),
  importance integer not null
    check (importance between 1 and 5),
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'conversation', 'imported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The composite index supports both per-user filtering and newest-first listing.
create index if not exists memories_user_created_at_idx
  on public.memories (user_id, created_at desc);

alter table public.memories enable row level security;

drop policy if exists "Users can select their own memories" on public.memories;
create policy "Users can select their own memories"
  on public.memories for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own memories" on public.memories;
create policy "Users can insert their own memories"
  on public.memories for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own memories" on public.memories;
create policy "Users can update their own memories"
  on public.memories for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own memories" on public.memories;
create policy "Users can delete their own memories"
  on public.memories for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_memories_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_memories_updated_at() from public;
grant execute on function public.set_memories_updated_at() to authenticated;

drop trigger if exists set_memories_updated_at on public.memories;
create trigger set_memories_updated_at
  before update on public.memories
  for each row execute function public.set_memories_updated_at();

-- Supabase API roles only need row-level operations; anon receives no table access.
revoke all on table public.memories from anon, authenticated;
grant select on table public.memories to authenticated;
grant insert (user_id, content, category, importance)
  on table public.memories to authenticated;
grant update (content, category, importance)
  on table public.memories to authenticated;
grant delete on table public.memories to authenticated;
