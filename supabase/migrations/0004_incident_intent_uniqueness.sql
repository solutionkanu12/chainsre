-- ChainSRE Phase 5 — one incident per intent.
--
-- The watcher may observe the same confirmed `SharesMinted` log more than
-- once (a duplicate poll, or overlapping backfill after a restart —
-- `03-System-Architecture.md` §9's "resume from cursor, backfill missed
-- blocks" is deliberately inclusive of blocks already seen, not exclusive,
-- since an off-by-one there would risk MISSING an event instead). A single
-- confirmed `intentId` must never produce more than one incident.
--
-- Enforced the same way `0002`'s `executions.idempotency_key` enforces "no
-- duplicate execution": a partial UNIQUE index, not an application-level
-- check-then-insert (which races under concurrency — two watcher instances,
-- or one instance's overlapping backfill range, could both pass a SELECT
-- check before either INSERT commits). `packages/db`'s
-- `createIncidentIfAbsent` is the insert-catch-lookup pattern this index
-- makes safe.
create unique index if not exists incidents_intent_id_key
  on public.incidents (intent_id)
  where intent_id is not null;
