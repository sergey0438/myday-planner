-- MyDay Planner — database schema for Supabase (PostgreSQL 15+)
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> Run.
-- It is idempotent: running it twice is safe.

-- ---------------------------------------------------------------- tables

create table if not exists public.categories (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon        text not null default 'tag' check (char_length(icon) <= 40),
  sort        integer not null default 0,
  builtin     text check (builtin is null or char_length(builtin) <= 20),
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

create table if not exists public.tasks (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title            text not null default '' check (char_length(title) <= 500),
  description      text not null default '' check (char_length(description) <= 10000),
  date             date,
  start_time       time,
  end_time         time,
  category_id      uuid references public.categories (id) on delete set null,
  priority         smallint not null default 0 check (priority between 0 and 3),
  location         text not null default '' check (char_length(location) <= 300),
  recurrence       jsonb check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  subtasks         jsonb not null default '[]'::jsonb check (jsonb_typeof(subtasks) = 'array'),
  favorite         boolean not null default false,
  completed_at     timestamptz,
  done_dates       date[] not null default '{}',
  skip_dates       date[] not null default '{}',
  postponed_count  integer not null default 0 check (postponed_count >= 0),
  deleted          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  constraint tasks_time_order check (end_time is null or start_time is null or end_time >= start_time)
);

create table if not exists public.user_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes

create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index if not exists tasks_user_date_idx on public.tasks (user_id, date) where not deleted;
create index if not exists tasks_category_idx on public.tasks (category_id);
create index if not exists categories_user_updated_idx on public.categories (user_id, updated_at);

-- ---------------------------------------------------------------- version + timestamps
-- Every update bumps "version" and "updated_at". The app updates rows with
-- "where version = <the version it last saw>", so concurrent edits are detected.

create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := now();
    if new.user_id is null then new.user_id := auth.uid(); end if;
  else
    new.version := old.version + 1;
    new.updated_at := now();
    new.user_id := old.user_id;      -- ownership can never change
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_bump_version on public.tasks;
create trigger tasks_bump_version before insert or update on public.tasks
  for each row execute function public.bump_version();

drop trigger if exists categories_bump_version on public.categories;
create trigger categories_bump_version before insert or update on public.categories
  for each row execute function public.bump_version();

create or replace function public.touch_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before insert or update on public.user_settings
  for each row execute function public.touch_settings();

-- A task may only reference a category of the same user.
create or replace function public.check_task_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'category % does not belong to the task owner', new.category_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_check_category on public.tasks;
create trigger tasks_check_category before insert or update of category_id on public.tasks
  for each row execute function public.check_task_category();

-- ---------------------------------------------------------------- row level security

alter table public.tasks enable row level security;
alter table public.categories enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "tasks: owner select" on public.tasks;
drop policy if exists "tasks: owner insert" on public.tasks;
drop policy if exists "tasks: owner update" on public.tasks;
drop policy if exists "tasks: owner delete" on public.tasks;
create policy "tasks: owner select" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks: owner insert" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks: owner update" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks: owner delete" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "categories: owner select" on public.categories;
drop policy if exists "categories: owner insert" on public.categories;
drop policy if exists "categories: owner update" on public.categories;
drop policy if exists "categories: owner delete" on public.categories;
create policy "categories: owner select" on public.categories for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories: owner insert" on public.categories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories: owner update" on public.categories for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories: owner delete" on public.categories for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "settings: owner all" on public.user_settings;
create policy "settings: owner all" on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- anonymous visitors get nothing
revoke all on public.tasks, public.categories, public.user_settings from anon;
grant select, insert, update, delete on public.tasks, public.categories, public.user_settings to authenticated;

-- ---------------------------------------------------------------- single-user lock
-- This is a personal app: once the first account exists, no one else can sign up,
-- even if public sign-ups are left enabled in the dashboard.

create or replace function public.only_one_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'MyDay Planner is a single-user app: registration is closed';
  end if;
  return new;
end;
$$;

drop trigger if exists myday_only_one_account on auth.users;
create trigger myday_only_one_account before insert on auth.users
  for each row execute function public.only_one_account();

-- ---------------------------------------------------------------- realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
      alter publication supabase_realtime add table public.tasks;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'categories') then
      alter publication supabase_realtime add table public.categories;
    end if;
  end if;
end;
$$;
