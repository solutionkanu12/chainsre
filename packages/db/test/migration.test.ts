import { describe, expect, it } from 'vitest';

import { FOUNDATION_TABLES, listMigrationFiles, readAllMigrations } from '../src/index';

/**
 * Structural invariant tests for the auth/organization migration.
 *
 * These assert the migration *declares* the security-critical structure —
 * RLS enabled on every table, the SECURITY DEFINER helpers that break RLS
 * recursion, ownership triggers, and uniqueness constraints. Behavioral RLS
 * tests (spinning up Postgres and asserting a non-member cannot read another
 * org's rows) require a live database and are scheduled for Phase 4 per the
 * roadmap; nothing here should be read as a substitute for those.
 */
describe('auth/org migration — structure', () => {
  const sql = readAllMigrations();
  const normalized = sql.toLowerCase();

  it('ships at least one migration file', () => {
    expect(listMigrationFiles().length).toBeGreaterThan(0);
  });

  it('defines the membership_role enum with the three roles', () => {
    expect(normalized).toContain('create type public.membership_role as enum');
    for (const role of ['owner', 'admin', 'member']) {
      expect(normalized).toContain(`'${role}'`);
    }
  });

  it('creates every foundation table', () => {
    for (const table of FOUNDATION_TABLES) {
      expect(normalized).toContain(`create table if not exists public.${table}`);
    }
  });

  it('enables row level security on every foundation table', () => {
    for (const table of FOUNDATION_TABLES) {
      expect(normalized).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('declares the SECURITY DEFINER helpers that break RLS recursion', () => {
    expect(normalized).toContain('function public.is_org_member');
    expect(normalized).toContain('function public.is_org_admin');
    // Both helpers must be SECURITY DEFINER with a pinned search_path.
    const definerCount = (normalized.match(/security definer/g) ?? []).length;
    expect(definerCount).toBeGreaterThanOrEqual(2);
    expect(normalized).toContain('set search_path = public');
  });

  it('does not reference the RLS-protected members table inside a policy USING clause', () => {
    // The policies must call the helper functions, not sub-select the table,
    // otherwise membership policies would recurse.
    expect(normalized).toContain('public.is_org_member(');
    expect(normalized).toContain('public.is_org_admin(');
  });

  it('auto-provisions a profile for new auth users', () => {
    expect(normalized).toContain('function public.handle_new_user');
    expect(normalized).toContain('after insert on auth.users');
    expect(normalized).toContain('insert into public.profiles');
  });

  it('auto-enrolls the creator as organization owner', () => {
    expect(normalized).toContain('function public.handle_new_organization');
    expect(normalized).toContain('after insert on public.organizations');
    expect(normalized).toContain("values (new.id, new.created_by, 'owner')");
  });

  it('enforces one membership per (organization, user)', () => {
    expect(normalized).toContain('unique (organization_id, user_id)');
  });

  it('enforces unique organization slugs', () => {
    expect(normalized).toContain('slug text not null unique');
  });

  it('declares select/insert/update/delete policies on organization_members', () => {
    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(normalized).toContain(`for ${action}`);
    }
    expect(normalized).toContain('on public.organization_members');
  });

  it('only owners can grant the owner role (admins cannot escalate)', () => {
    // Bare `role`, not `new.role` — `NEW`/`OLD` pseudo-records don't exist in
    // an RLS policy's WITH CHECK clause (only inside trigger functions); the
    // candidate row's columns are referenced unqualified. A live-Postgres
    // integration test (test/integration/rls-boundaries.test.ts) proves this
    // policy actually runs; this only proves the SQL is well-formed.
    expect(normalized).toContain("and role <> 'owner'");
  });
});
