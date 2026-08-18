-- ============================================================
-- Follow-up Funnel — Supabase schema
-- Run this once in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists pgcrypto;

-- One row per login (both admins and RMs), linked to Supabase's built-in auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'rm')),
  must_change_password boolean not null default true,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- Security-definer helper: lets policies check "is this user an admin?"
-- without recursively re-triggering RLS on profiles.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "admin can view all profiles"
  on profiles for select
  using (is_admin());

-- Follow-up records
create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  rm_id uuid not null references profiles(id) on delete cascade,
  rm_name text not null,
  cx_name text not null,
  contact text not null,
  quoted_value numeric default 0,
  follow_up_date date not null,
  follow_up_time time not null,
  lead_type text not null check (lead_type in ('Hot', 'Warm', 'Cold')),
  status text not null default 'Pending' check (status in ('Pending', 'Done')),
  created_at timestamptz default now()
);

alter table followups enable row level security;

create policy "rm views own, admin views all"
  on followups for select
  using (rm_id = auth.uid() or is_admin());

create policy "rm inserts own, admin inserts any"
  on followups for insert
  with check (rm_id = auth.uid() or is_admin());

create policy "rm updates own, admin updates any"
  on followups for update
  using (rm_id = auth.uid() or is_admin());

create policy "rm deletes own, admin deletes any"
  on followups for delete
  using (rm_id = auth.uid() or is_admin());

-- ============================================================
-- After running this: create your first Admin account by hand.
-- 1. Dashboard > Authentication > Users > Add user
--    (enter an email + password, tick "Auto Confirm User")
-- 2. Copy that user's UUID from the Users list
-- 3. Run (must_change_password: false since you already chose
--    your own real password just now):
--    insert into profiles (id, full_name, role, must_change_password)
--    values ('paste-uuid-here', 'Your Name', 'admin', false);
-- ============================================================

-- ============================================================
-- MIGRATION — if you already ran this schema before and just
-- added the must_change_password column, run this instead of
-- recreating everything:
--
--   alter table profiles
--     add column if not exists must_change_password boolean not null default true;
--
--   -- then mark your existing admin as already set up:
--   update profiles set must_change_password = false where role = 'admin';
-- ============================================================
