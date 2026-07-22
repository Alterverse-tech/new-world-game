-- WhiteRoom player profiles live in each environment's own Supabase project.
-- Apply this migration separately to DEV and production; it does not copy data
-- or credentials between the two projects.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  game_nickname text,
  avatar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists game_nickname text,
  add column if not exists avatar_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'whiteroom_profiles_select_own'
  ) then
    create policy whiteroom_profiles_select_own
      on public.profiles
      for select
      to authenticated
      using ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'whiteroom_profiles_insert_own'
  ) then
    create policy whiteroom_profiles_insert_own
      on public.profiles
      for insert
      to authenticated
      with check ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'whiteroom_profiles_update_own'
  ) then
    create policy whiteroom_profiles_update_own
      on public.profiles
      for update
      to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;
end
$$;

create or replace function public.whiteroom_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'WhiteRoom 玩家'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'whiteroom_create_profile_on_signup'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ) then
    create trigger whiteroom_create_profile_on_signup
      after insert on auth.users
      for each row execute function public.whiteroom_handle_new_user();
  end if;
end
$$;

-- Existing DEV users signed up before this migration also need a profile row.
insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(
    nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'WhiteRoom 玩家'
  )
from auth.users as users
on conflict (id) do nothing;

notify pgrst, 'reload schema';
