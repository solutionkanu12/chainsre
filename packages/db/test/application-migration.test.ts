import { describe, expect, it } from 'vitest';

import {
  APPLICATION_TABLES,
  PUBLIC_READABLE_TABLES,
  SERVICE_ROLE_ONLY_TABLES,
  listMigrationFiles,
  readAllMigrations,
} from '../src/index';

/**
 * Structural invariant tests for the Phase 4 application-data migration and
 * seed. These assert the SQL *declares* the required structure — every
 * table, RLS enabled everywhere, the public-read/service-role-write-only
 * policy split, the append-only trigger, numeric-safe column types, and the
 * uniqueness constraints the duplicate-execution and duplicate-containment
 * guarantees depend on.
 *
 * These are NOT a substitute for the live-Postgres behavioral tests in
 * `test/integration/` (duplicate execution rejected, duplicate containment
 * rejected, invalid transitions rejected, RLS boundaries enforced against
 * real anon/authenticated/service_role connections) — this file only proves
 * the SQL says the right thing, not that Postgres enforces it.
 */
describe('Phase 4 application-data migration — structure', () => {
  const sql = readAllMigrations();
  const normalized = sql.toLowerCase();

  it('ships the application-data and seed migrations in order after 0001', () => {
    const files = listMigrationFiles();
    expect(files).toContain('0001_auth_org_foundation.sql');
    expect(files).toContain('0002_application_data.sql');
    expect(files).toContain('0003_seed_protected_enrollment.sql');
    expect(files.indexOf('0002_application_data.sql')).toBeGreaterThan(
      files.indexOf('0001_auth_org_foundation.sql'),
    );
    expect(files.indexOf('0003_seed_protected_enrollment.sql')).toBeGreaterThan(
      files.indexOf('0002_application_data.sql'),
    );
  });

  it('creates every application table', () => {
    for (const table of APPLICATION_TABLES) {
      expect(normalized).toContain(`create table if not exists public.${table}`);
    }
  });

  it('enables row level security on every application table', () => {
    for (const table of APPLICATION_TABLES) {
      expect(normalized).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('grants a public SELECT policy on every publicly-readable table', () => {
    for (const table of PUBLIC_READABLE_TABLES) {
      expect(normalized).toContain(
        `create policy ${table}_select_public\n  on public.${table} for select\n  using (true)`,
      );
    }
  });

  it('defines no policy at all for the service-role-only tables', () => {
    for (const table of SERVICE_ROLE_ONLY_TABLES) {
      expect(normalized).not.toContain(`on public.${table} for select`);
      expect(normalized).not.toContain(`on public.${table} for insert`);
    }
  });

  it('never grants an insert/update/delete policy on any application table', () => {
    // Writes go through service_role (which bypasses RLS) after the API
    // server verifies the operator out-of-band; no anon/authenticated role
    // should ever be granted a write policy on these tables.
    for (const table of APPLICATION_TABLES) {
      expect(normalized).not.toContain(`on public.${table} for insert`);
      expect(normalized).not.toContain(`on public.${table} for update`);
      expect(normalized).not.toContain(`on public.${table} for delete`);
    }
  });

  it('makes incident_events append-only with a trigger that fires for every role', () => {
    expect(normalized).toContain('function public.forbid_incident_event_mutation');
    expect(normalized).toContain('before update on public.incident_events');
    expect(normalized).toContain('before delete on public.incident_events');
    expect(normalized).toContain("raise exception 'incident_events is append-only");
  });

  it('uses text with a base-10-integer CHECK — never numeric/integer/float — for uint256-scale amounts', () => {
    // Not `numeric`: PostgREST serializes `numeric` as a bare JSON number
    // (via Postgres's own to_json()), which is exactly the precision-loss
    // path this constraint exists to prevent — see the migration's header
    // comment. `text` is what actually survives the real (PostgREST) wire
    // protocol as a string, matching @chainsre/shared's `uintString` shape.
    for (const column of ['declared_amount', 'executed_amount', 'nonce', 'gas_used_wei']) {
      expect(normalized).toMatch(new RegExp(`${column} text`));
      expect(normalized).not.toMatch(new RegExp(`${column} numeric`));
      expect(normalized).not.toMatch(new RegExp(`${column} integer`));
    }
  });

  it('uses bigint for block numbers and unix-second timestamps, never JS-unsafe types', () => {
    for (const column of ['deadline', 'block_number', 'last_processed_block']) {
      expect(normalized).toContain(`${column} bigint`);
    }
  });

  it('the executions.idempotency_key column is UNIQUE — the duplicate-execution guarantee', () => {
    expect(normalized).toContain(
      'idempotency_key text not null check (char_length(idempotency_key) > 0)',
    );
    expect(normalized).toContain('unique (idempotency_key)');
  });

  it('has a partial unique index on provider_execution_id so a KeeperHub id maps to one row', () => {
    expect(normalized).toContain(
      'create unique index if not exists executions_provider_execution_id_key',
    );
    expect(normalized).toContain('where provider_execution_id is not null');
  });

  it('has a containment_locked_at column — the one-time containment-lock guarantee', () => {
    expect(normalized).toContain('containment_locked_at timestamptz');
    expect(normalized).toContain('containment_locked_by text');
  });

  it('enforces one commitment per intent_hash and per (agent_address, nonce), mirroring the on-chain registry', () => {
    expect(normalized).toContain('unique (intent_hash)');
    expect(normalized).toContain('unique (agent_address, nonce)');
  });

  it('enforces one enrollment per (chain, contract, selector)', () => {
    expect(normalized).toContain('unique (chain_id, contract_address, action_selector)');
  });

  it('enforces a strictly ordered, gap-free-per-incident event sequence', () => {
    expect(normalized).toContain('unique (incident_id, sequence)');
  });

  it('enforces one-time-use auth challenges via a unique nonce_hash', () => {
    expect(normalized).toContain('unique (nonce_hash)');
  });

  it('does not add an organization_id column to any application table', () => {
    // Deliberate: see the migration header comment for why. The 0001
    // organizations/members model and its RLS are untouched by this file.
    for (const table of APPLICATION_TABLES) {
      const tableBlock = sql
        .toLowerCase()
        .split(`create table if not exists public.${table} (`)[1]
        ?.split(');')[0];
      expect(tableBlock ?? '').not.toContain('organization_id');
    }
  });

  it('seeds exactly the real protected vault enrollment, idempotently', () => {
    expect(normalized).toContain('insert into public.enrollments');
    expect(normalized).toContain('84532');
    expect(normalized).toContain("'0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b'");
    expect(normalized).toContain("'0xdd10f8ca'");
    expect(normalized).toContain("'hlf2xtixpndbm24dmj5kg'");
    expect(normalized).toContain(
      'on conflict (chain_id, contract_address, action_selector) do nothing',
    );
  });

  it('does NOT seed the control vault', () => {
    // Scoped to the actual seeded VALUES, not the migration's explanatory
    // comments (which legitimately name the control vault as context for
    // why it is excluded).
    const insertBlock = normalized.split('insert into public.enrollments')[1]?.split(';')[0] ?? '';
    expect(insertBlock).not.toBe('');
    // 0xF0Dd43FBbEA515f2fa8e2c0C0a2C60f5eFC6f3b5, lowercased.
    expect(insertBlock).not.toContain('0xf0dd43fbbea515f2fa8e2c0c0a2c60f5efc6f3b5');
  });
});
