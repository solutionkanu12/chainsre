-- ChainSRE Phase 1 — authentication & organization foundation.
--
-- Establishes the multi-tenant primitives every later phase builds on:
-- profiles mirrored from auth.users, organizations, and role-based
-- memberships, all protected by row-level security. Application data tables
-- (enrollments, intents, executions, incidents, …) are intentionally NOT
-- created here — they belong to Phase 4.
--
-- RLS recursion note: membership visibility is enforced through
-- SECURITY DEFINER helper functions rather than subqueries that re-read the
-- same RLS-protected tables. This is what keeps the policies non-recursive.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type public.membership_role as enum ('owner', 'admin', 'member');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One profile row per auth user. Mirrors auth.users so application tables can
-- reference a public row and RLS can key off auth.uid().
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  -- A user has at most one membership row per organization.
  unique (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);
create index if not exists organization_members_org_id_idx
  on public.organization_members (organization_id);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (break RLS recursion)
-- ---------------------------------------------------------------------------

-- True when the given user has any membership in the org. Runs as definer so
-- it can read organization_members without triggering that table's RLS.
create or replace function public.is_org_member(org_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = uid
  );
$$;

-- True when the given user is an owner or admin of the org.
create or replace function public.is_org_admin(org_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = uid
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_org_member(uuid, uuid) from public;
revoke all on function public.is_org_admin(uuid, uuid) from public;
-- Also grant to `anon`, not just `authenticated`: the SELECT policies below
-- evaluate this function for EVERY role, including an unauthenticated one.
-- Without this grant, an anon SELECT on `organizations` errors with
-- "permission denied for function is_org_member" instead of cleanly
-- filtering to zero rows — a real gap this migration had until a live
-- integration test (Phase 4, `packages/db/test/integration`) exercised it
-- for the first time. anon still sees nothing it isn't a member of; this
-- only fixes how that "nothing" is returned.
grant execute on function public.is_org_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_org_admin(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- Create a profile automatically when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The organization creator is automatically enrolled as its owner.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- Profiles: a user can see and edit only their own profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Organizations: members can read; admins/owners can update; any authenticated
-- user can create an org they own (created_by must be themselves).
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations for select
  using (public.is_org_member(id, auth.uid()));

drop policy if exists organizations_insert_self on public.organizations;
create policy organizations_insert_self
  on public.organizations for insert
  with check (created_by = auth.uid());

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin
  on public.organizations for update
  using (public.is_org_admin(id, auth.uid()))
  with check (public.is_org_admin(id, auth.uid()));

drop policy if exists organizations_delete_admin on public.organizations;
create policy organizations_delete_admin
  on public.organizations for delete
  using (public.is_org_admin(id, auth.uid()));

-- Membership rows: a user can read their own membership and (via the helper)
-- memberships of orgs they belong to. Admins manage memberships; only the
-- auto-enrollment trigger (or a future owner-only flow) may assign the
-- `owner` role, so an admin cannot escalate themselves to owner.
drop policy if exists members_select_visible on public.organization_members;
create policy members_select_visible
  on public.organization_members for select
  using (user_id = auth.uid() or public.is_org_member(organization_id, auth.uid()));

drop policy if exists members_insert_admin on public.organization_members;
create policy members_insert_admin
  on public.organization_members for insert
  with check (
    public.is_org_admin(organization_id, auth.uid())
    and role <> 'owner'
  );

drop policy if exists members_update_admin on public.organization_members;
create policy members_update_admin
  on public.organization_members for update
  using (public.is_org_admin(organization_id, auth.uid()))
  with check (
    public.is_org_admin(organization_id, auth.uid())
    and role <> 'owner'
  );

drop policy if exists members_delete_admin on public.organization_members;
create policy members_delete_admin
  on public.organization_members for delete
  using (public.is_org_admin(organization_id, auth.uid()));
