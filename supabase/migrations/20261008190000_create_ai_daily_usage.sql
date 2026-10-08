-- Run as the project database owner in a reviewed Supabase migration.
-- This function is intentionally callable by authenticated users: a direct call can
-- only consume the caller's own fixed daily allowance. No refund or reset API exists.

begin;

create table public.ai_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  used_count integer not null default 0 check (used_count between 0 and 30),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, usage_date)
);

alter table public.ai_daily_usage enable row level security;

-- No RLS policies and no table grants: API roles cannot read or mutate counters.
revoke all on table public.ai_daily_usage from public, anon, authenticated;

create function public.reserve_cloud_ai_quota()
returns table (
  allowed boolean,
  remaining_count integer,
  usage_date date,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_usage_date date := (pg_catalog.now() at time zone 'UTC')::date;
  v_used_count integer;
  v_reset_at timestamptz := (v_usage_date + 1)::timestamp at time zone 'UTC';
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- The primary key serializes concurrent reservations for one user and UTC day.
  -- A conflict update that reaches 30 changes no row and returns no value.
  insert into public.ai_daily_usage as usage (user_id, usage_date, used_count)
  values (v_user_id, v_usage_date, 1)
  on conflict on constraint ai_daily_usage_pkey do update
    set used_count = usage.used_count + 1,
        updated_at = pg_catalog.now()
    where usage.used_count < 30
  returning usage.used_count into v_used_count;

  if v_used_count is null then
    return query select false, 0, v_usage_date, v_reset_at;
  else
    return query select true, 30 - v_used_count, v_usage_date, v_reset_at;
  end if;
end;
$$;

-- Postgres grants function EXECUTE to PUBLIC by default. Restrict this RPC.
revoke all on function public.reserve_cloud_ai_quota() from public, anon, authenticated;
grant execute on function public.reserve_cloud_ai_quota() to authenticated;

commit;
