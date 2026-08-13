import { randomUUID } from 'node:crypto';

import type { Client as PgClient } from 'pg';

/**
 * Create an `auth.users` row (which the real migration's `handle_new_user`
 * trigger turns into a `profiles` row) and an organization owned by that
 * user (which `handle_new_organization` turns into an `owner` membership).
 * Uses the admin (superuser) connection deliberately — this is fixture
 * arrangement, not something under test.
 */
export async function createUserAndOrg(
  admin: PgClient,
  opts: { email?: string; orgName?: string } = {},
): Promise<{ userId: string; orgId: string; slug: string }> {
  const userId = randomUUID();
  const email = opts.email ?? `${userId}@example.test`;
  await admin.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);

  const orgId = randomUUID();
  const slug = `org-${userId.slice(0, 8)}`;
  await admin.query(
    'insert into public.organizations (id, name, slug, created_by) values ($1, $2, $3, $4)',
    [orgId, opts.orgName ?? `Org ${slug}`, slug, userId],
  );

  return { userId, orgId, slug };
}
