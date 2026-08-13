-- Test-only shim reproducing the parts of the real Supabase platform that
-- the real migrations assume already exist: the anon/authenticated/
-- service_role roles, the `auth` schema, `auth.users`, and
-- `auth.uid()`/`auth.role()`. Identical to
-- `packages/db/test/integration/support/shim.sql` — duplicated rather than
-- shared so the watcher's test suite doesn't couple to packages/db's.
--
-- NEVER applied to a real Supabase project — the real platform provides all
-- of this natively; this file exists solely so the real migrations can be
-- exercised against a bare `postgres` + `postgrest` pair in CI/local tests.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
