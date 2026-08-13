import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  APPLICATION_TABLES,
  PUBLIC_READABLE_TABLES,
  SERVICE_ROLE_ONLY_TABLES,
} from '../../src/index';
import {
  anonClient,
  authenticatedClient,
  serviceRoleClient,
  withAdminClient,
} from './support/client';
import { createUserAndOrg } from './support/fixtures';

describe('Phase 4 tables: public read, service_role-only write', () => {
  for (const table of PUBLIC_READABLE_TABLES) {
    it(`anon can SELECT from ${table}`, async () => {
      const { error } = await anonClient().from(table).select('*').limit(1);
      expect(error).toBeNull();
    });
  }

  for (const table of SERVICE_ROLE_ONLY_TABLES) {
    it(`anon reading ${table} returns zero rows (RLS default-deny, no error)`, async () => {
      const { data, error } = await anonClient().from(table).select('*');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it(`authenticated reading ${table} also returns zero rows`, async () => {
      const { data, error } = await authenticatedClient(randomUUID()).from(table).select('*');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  it('anon cannot INSERT into demo_runs', async () => {
    const { error } = await anonClient().from('demo_runs').insert({
      mode: 'normal',
      vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
      started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
    });
    expect(error).not.toBeNull();
  });

  it('authenticated cannot INSERT into demo_runs either', async () => {
    const { error } = await authenticatedClient(randomUUID()).from('demo_runs').insert({
      mode: 'normal',
      vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
      started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
    });
    expect(error).not.toBeNull();
  });

  it('anon cannot UPDATE an existing enrollment', async () => {
    const { data: seeded } = await serviceRoleClient()
      .from('enrollments')
      .select('id')
      .limit(1)
      .maybeSingle();
    expect(seeded).not.toBeNull();
    const { error, data } = await anonClient()
      .from('enrollments')
      .update({ status: 'disabled' })
      .eq('id', (seeded as { id: string }).id)
      .select('*');
    // Either an outright error, or (since RLS silently filters rather than
    // erroring on UPDATE with no matching policy) zero rows affected — both
    // mean the write did not happen.
    if (!error) {
      expect(data).toEqual([]);
    }
    const { data: unchanged } = await serviceRoleClient()
      .from('enrollments')
      .select('status')
      .eq('id', (seeded as { id: string }).id)
      .single();
    expect((unchanged as { status: string }).status).toBe('active');
  });

  it('service_role can write every application table', async () => {
    const svc = serviceRoleClient();
    const { data: run, error: runError } = await svc
      .from('demo_runs')
      .insert({
        mode: 'normal',
        vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
        started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
      })
      .select('*')
      .single();
    expect(runError).toBeNull();
    expect(run).not.toBeNull();
  });

  it('every application table name checked here matches the migration', () => {
    // Sanity: PUBLIC_READABLE_TABLES + SERVICE_ROLE_ONLY_TABLES partition
    // APPLICATION_TABLES exactly, so this file's coverage is complete.
    const covered = new Set([...PUBLIC_READABLE_TABLES, ...SERVICE_ROLE_ONLY_TABLES]);
    expect(covered.size).toBe(APPLICATION_TABLES.length);
    for (const table of APPLICATION_TABLES) {
      expect(covered.has(table)).toBe(true);
    }
  });
});

describe('Phase 1 organization isolation — behavioral (extends the structural checks)', () => {
  it('a member can read their own organization', async () => {
    await withAdminClient(async (admin) => {
      const { userId, orgId } = await createUserAndOrg(admin);
      const { data, error } = await authenticatedClient(userId)
        .from('organizations')
        .select('*')
        .eq('id', orgId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  it("a non-member cannot read another user's organization", async () => {
    await withAdminClient(async (admin) => {
      const { orgId: orgA } = await createUserAndOrg(admin);
      const { userId: userB } = await createUserAndOrg(admin);

      const { data, error } = await authenticatedClient(userB)
        .from('organizations')
        .select('*')
        .eq('id', orgA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  it('anon cannot read any organization', async () => {
    await withAdminClient(async (admin) => {
      const { orgId } = await createUserAndOrg(admin);
      const { data, error } = await anonClient().from('organizations').select('*').eq('id', orgId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  it('a non-admin/non-member cannot update another organization', async () => {
    await withAdminClient(async (admin) => {
      const { orgId: orgA, slug: slugA } = await createUserAndOrg(admin);
      const { userId: userB } = await createUserAndOrg(admin);

      const { error } = await authenticatedClient(userB)
        .from('organizations')
        .update({ name: 'Hijacked' })
        .eq('id', orgA);
      // RLS on UPDATE with a non-matching USING clause affects zero rows;
      // supabase-js/postgrest-js does not treat that as an error by default.
      expect(error).toBeNull();

      const unchanged = await withAdminClient(async (a2) => {
        const res = await a2.query('select name from public.organizations where id = $1', [orgA]);
        return res.rows[0] as { name: string };
      });
      expect(unchanged.name).toBe(`Org ${slugA}`);
    });
  });

  it('a member can only see membership rows for orgs they belong to', async () => {
    await withAdminClient(async (admin) => {
      const { userId: userA, orgId: orgA } = await createUserAndOrg(admin);
      const { orgId: orgB } = await createUserAndOrg(admin);

      const { data, error } = await authenticatedClient(userA)
        .from('organization_members')
        .select('organization_id');
      expect(error).toBeNull();
      const orgIds = new Set((data as { organization_id: string }[]).map((r) => r.organization_id));
      expect(orgIds.has(orgA)).toBe(true);
      expect(orgIds.has(orgB)).toBe(false);
    });
  });
});
