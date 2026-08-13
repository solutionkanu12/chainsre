import { beforeAll, describe, expect, it } from 'vitest';

import {
  appendIncidentEvent,
  createDemoRun,
  createIncident,
  listIncidentEvents,
  type DbClient,
} from '../../src/index';
import { serviceRoleClient } from './support/client';

/**
 * `incident_events` must be append-only even against `service_role` — the
 * role every other Phase 4 write goes through. RLS alone cannot guarantee
 * this (service_role bypasses RLS by design), so the migration adds a
 * trigger that rejects UPDATE/DELETE unconditionally. This proves that
 * trigger actually fires against a real Postgres instance.
 */
describe('incident_events is append-only, even for service_role', () => {
  let db: DbClient;

  beforeAll(() => {
    db = serviceRoleClient();
  });

  async function freshIncident() {
    const run = await createDemoRun(db, {
      mode: 'protected_attack',
      vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
      started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
    });
    return createIncident(db, { run_id: run.id, mismatch_fields: ['shares'] });
  }

  it('assigns increasing sequence numbers automatically', async () => {
    const incident = await freshIncident();
    const first = await appendIncidentEvent(db, incident.id, { type: 'detected', status: 'ok' });
    const second = await appendIncidentEvent(db, incident.id, {
      type: 'containment_queued',
      status: 'ok',
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);

    const events = await listIncidentEvents(db, incident.id);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('rejects direct UPDATE, even from service_role', async () => {
    const incident = await freshIncident();
    const event = await appendIncidentEvent(db, incident.id, { type: 'detected', status: 'ok' });

    const { error } = await db
      .from('incident_events')
      .update({ message: 'rewritten history' })
      .eq('id', event.id);
    expect(error).not.toBeNull();
    expect(String(error?.message)).toContain('append-only');
  });

  it('rejects direct DELETE, even from service_role', async () => {
    const incident = await freshIncident();
    const event = await appendIncidentEvent(db, incident.id, { type: 'detected', status: 'ok' });

    const { error } = await db.from('incident_events').delete().eq('id', event.id);
    expect(error).not.toBeNull();
    expect(String(error?.message)).toContain('append-only');

    const remaining = await listIncidentEvents(db, incident.id);
    expect(remaining.map((e) => e.id)).toContain(event.id);
  });

  it('concurrent appends to the same incident never collide on sequence', async () => {
    const incident = await freshIncident();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        appendIncidentEvent(db, incident.id, { type: `step-${i}`, status: 'ok' }),
      ),
    );
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
