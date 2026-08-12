# Supabase

Database and authentication foundation for ChainSRE.

## Migrations

SQL migrations live in `migrations/` and are applied in lexical order:

- `0001_auth_org_foundation.sql` — profiles, organizations, role-based
  memberships, SECURITY DEFINER helpers, ownership triggers, and row-level
  security policies.

Application data tables (enrollments, intents, executions, incidents, chain
cursors, …) are added in **Phase 4** and are intentionally absent here.

## Applying

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push          # against a linked project
# or, for a local stack:
supabase start && supabase db reset
```

Migrations are plain SQL and can also be run through any Postgres client
against the target database.

## Security model

- RLS is enabled on every table.
- Membership visibility is enforced via `is_org_member` / `is_org_admin`
  SECURITY DEFINER functions so policies never re-query an RLS-protected table
  (which would recurse).
- The organization creator is auto-enrolled as `owner` via an `AFTER INSERT`
  trigger, avoiding the chicken-and-egg where no one could yet manage
  memberships.

Structural invariants (RLS enabled, helpers present, constraints present) are
verified by `packages/db` tests. Behavioral RLS tests against a live Postgres
are scheduled for Phase 4.
