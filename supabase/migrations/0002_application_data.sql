-- ChainSRE Phase 4 — application data.
--
-- The tables ChainSRE's product actually runs on: enrollments, demo runs,
-- intents, executions, incidents, the append-only incident timeline, watcher
-- cursors, and operator wallet-auth challenges. See `02-Hackathon-PRD.md` §12
-- for the field list this migration implements.
--
-- Authorization model (deliberately different from 0001's org/member model):
--
--   ChainSRE's operator authentication is a wallet-signature challenge
--   verified by the API server (`02-Hackathon-PRD.md` §14), NOT Supabase Auth
--   — there is no `auth.uid()` for an operator, and the product has exactly
--   one deployment with no multi-tenant concept for its own data (one set of
--   contracts, one KeeperHub org, one protected vault). Bolting an
--   `organization_id` onto these tables would invent a tenant boundary the
--   product doesn't have and that Phase 4 has nothing correct to seed it
--   with. Instead, every table here follows the PRD's own authorization
--   model exactly: "Public: readiness summary, runs, intents, incidents, and
--   evidence" (§12/§14) is read access granted to every role, and every
--   write is granted to `service_role` only — i.e. the API server, which
--   independently verifies the operator's wallet signature and allowlist
--   membership before writing, in application code. RLS still fully applies
--   to `anon`/`authenticated`: this is default-deny-writes, not
--   RLS-disabled. `chain_cursors` and `auth_challenges` are pure backend
--   bookkeeping with no public-read purpose in the PRD's API surface, so
--   they get no anon/authenticated policy at all (service_role only).
--
--   0001's organizations/profiles/members model and its RLS are untouched by
--   this migration.
--
-- Numeric safety: every on-chain integer that can exceed 2^53 (shares,
-- nonces, gas) is `text`, constrained to a base-10 non-negative integer
-- string with the same `^(0|[1-9][0-9]*)$` shape `@chainsre/shared`'s
-- `uintString` Zod primitive already enforces at the TypeScript layer.
--
-- This is `text`, not `numeric(78,0)`, despite `02-Hackathon-PRD.md` §12
-- listing both as acceptable ("strings or numeric(78,0)") — and despite `pg`
-- returning `numeric` as a JS string by default. The actual runtime path for
-- every one of these tables is PostgREST (`@supabase/supabase-js` talks
-- HTTP/JSON, never opens a raw `pg` connection), and PostgREST serializes a
-- `numeric` column with Postgres's own `to_json()`, which emits a bare JSON
-- NUMBER, not a string — `JSON.parse` on the wire silently loses precision
-- above 2^53 with no error. A live integration test (Phase 4,
-- `packages/db/test/integration/state-transitions.test.ts`) caught this by
-- actually reading a large nonce back through PostgREST; `numeric(78,0)`
-- would have looked correct in every structural/string-matching test and
-- only failed in production, on a real large value. `text` is what actually
-- survives the real wire protocol unchanged.
--
-- `bigint` is kept only for values that are safe as plain JS numbers by
-- realistic magnitude, not merely by type width (block numbers, unix-second
-- deadlines, latency in ms) — none of these come remotely close to 2^53 for
-- any chain or any realistic run duration.

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null check (chain_id > 0),
  contract_address text not null
    check (contract_address ~ '^0x[0-9a-f]{40}$'),
  action_selector text not null
    check (action_selector ~ '^0x[0-9a-f]{8}$'),
  policy_version text not null default 'v1',
  guardian_workflow_id text not null check (char_length(guardian_workflow_id) > 0),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, contract_address, action_selector)
);

drop trigger if exists enrollments_set_updated_at on public.enrollments;
create trigger enrollments_set_updated_at
  before update on public.enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- demo_runs
-- ---------------------------------------------------------------------------
create table if not exists public.demo_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('normal', 'protected_attack', 'control_attack')),
  -- State machine per `03-System-Architecture.md` §14.
  status text not null default 'created' check (status in (
    'created', 'planning', 'committing', 'committed', 'executing', 'confirmed',
    'evaluating', 'responding', 'testing_containment', 'completed',
    'planning_failed', 'commit_failed', 'action_failed', 'detection_timeout',
    'containment_failed', 'demo_failed'
  )),
  vault_address text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  declared_amount text check (declared_amount is null or declared_amount ~ '^(0|[1-9][0-9]*)$'),
  executed_amount text check (executed_amount is null or executed_amount ~ '^(0|[1-9][0-9]*)$'),
  started_by text not null check (started_by ~ '^0x[0-9a-f]{40}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);

create index if not exists demo_runs_status_idx on public.demo_runs (status);

drop trigger if exists demo_runs_set_updated_at on public.demo_runs;
create trigger demo_runs_set_updated_at
  before update on public.demo_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- intents
-- ---------------------------------------------------------------------------
create table if not exists public.intents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.demo_runs (id) on delete cascade,
  agent_address text not null check (agent_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check (chain_id > 0),
  target_address text not null check (target_address ~ '^0x[0-9a-f]{40}$'),
  selector text not null check (selector ~ '^0x[0-9a-f]{8}$'),
  -- Structured action params (e.g. { receiver, shares }); shares carried as a
  -- JSON string inside here too, never a bare JSON number.
  params jsonb not null default '{}'::jsonb,
  params_hash text not null check (params_hash ~ '^0x[0-9a-f]{64}$'),
  intent_hash text not null check (intent_hash ~ '^0x[0-9a-f]{64}$'),
  -- uint64 replay-protection nonce.
  nonce text not null check (nonce ~ '^(0|[1-9][0-9]*)$'),
  -- Unix-second deadline.
  deadline bigint not null check (deadline >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'committed', 'commit_failed', 'expired')),
  created_at timestamptz not null default now(),
  -- The on-chain registry rejects a duplicate commitment and a reused
  -- (agent, nonce) pair (`IntentRegistry.sol`); mirror both invariants here
  -- so a bug surfaces at insert time, not only on the chain.
  unique (intent_hash),
  unique (agent_address, nonce)
);

create index if not exists intents_run_id_idx on public.intents (run_id);
create index if not exists intents_status_idx on public.intents (status);

-- ---------------------------------------------------------------------------
-- executions
-- ---------------------------------------------------------------------------
create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.demo_runs (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete set null,
  kind text not null check (kind in ('commit', 'action', 'guardian', 'drain_attempt')),
  -- KeeperHub's own execution/workflow-execution id. Assigned after the
  -- idempotency_key below, once KeeperHub accepts the broadcast.
  provider_execution_id text,
  -- `chainsre:{runId}:{step}` — the single source of truth for "have we
  -- already asked KeeperHub to do this". UNIQUE below is what makes a
  -- duplicate execution impossible to store, independent of any
  -- application-level check.
  idempotency_key text not null check (char_length(idempotency_key) > 0),
  function_name text not null,
  function_args jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  tx_hash text check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  tx_link text,
  block_number bigint check (block_number is null or block_number >= 0),
  gas_used_wei text check (gas_used_wei is null or gas_used_wei ~ '^(0|[1-9][0-9]*)$'),
  error text,
  raw_receipt jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (idempotency_key),
  check (completed_at is null or completed_at >= created_at)
);

create index if not exists executions_run_id_idx on public.executions (run_id);
create index if not exists executions_intent_id_idx on public.executions (intent_id);
create index if not exists executions_status_idx on public.executions (status);
-- A given KeeperHub execution id must correspond to exactly one of our rows,
-- but the column stays nullable until KeeperHub actually assigns one.
create unique index if not exists executions_provider_execution_id_key
  on public.executions (provider_execution_id)
  where provider_execution_id is not null;

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.demo_runs (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete set null,
  severity text not null default 'critical'
    check (severity in ('critical', 'high', 'medium', 'low')),
  -- State machine per `03-System-Architecture.md` §14.
  state text not null default 'detected' check (state in (
    'detected', 'containment_queued', 'containment_running',
    'containment_confirmed', 'state_verified', 'contained', 'containment_failed'
  )),
  expected jsonb,
  actual jsonb,
  mismatch_fields text[] not null default '{}',
  action_tx_hash text check (action_tx_hash is null or action_tx_hash ~ '^0x[0-9a-f]{64}$'),
  guardian_execution_id text,
  -- One-time containment lock. Set exactly once by an atomic
  -- `update ... where containment_locked_at is null returning *`
  -- (`packages/db`'s `acquireContainmentLock`) — the row lock that statement
  -- takes is what makes a second concurrent attempt fail to also win it, so
  -- at most one caller ever proceeds to trigger the guardian workflow for a
  -- given incident.
  containment_locked_at timestamptz,
  containment_locked_by text,
  detected_at timestamptz not null default now(),
  containment_started_at timestamptz,
  contained_at timestamptz,
  detection_latency_ms bigint check (detection_latency_ms is null or detection_latency_ms >= 0),
  containment_latency_ms bigint check (containment_latency_ms is null or containment_latency_ms >= 0),
  created_at timestamptz not null default now(),
  check (containment_started_at is null or containment_started_at >= detected_at),
  check (contained_at is null or contained_at >= containment_started_at)
);

create index if not exists incidents_run_id_idx on public.incidents (run_id);
create index if not exists incidents_intent_id_idx on public.incidents (intent_id);
create index if not exists incidents_state_idx on public.incidents (state);

-- ---------------------------------------------------------------------------
-- incident_events (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  type text not null,
  status text not null,
  message text,
  evidence jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (incident_id, sequence)
);

create index if not exists incident_events_incident_id_idx on public.incident_events (incident_id);

-- Append-only, enforced with a trigger rather than only RLS: RLS is bypassed
-- by `service_role` (the API server's own write path), and the whole point
-- of an append-only timeline is that not even the server can rewrite
-- history. The trigger fires for every role, unconditionally.
create or replace function public.forbid_incident_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'incident_events is append-only: % is not permitted', TG_OP;
end;
$$;

drop trigger if exists incident_events_no_update on public.incident_events;
create trigger incident_events_no_update
  before update on public.incident_events
  for each row execute function public.forbid_incident_event_mutation();

drop trigger if exists incident_events_no_delete on public.incident_events;
create trigger incident_events_no_delete
  before delete on public.incident_events
  for each row execute function public.forbid_incident_event_mutation();

-- ---------------------------------------------------------------------------
-- chain_cursors
-- ---------------------------------------------------------------------------
-- Watcher bookkeeping only — not part of the PRD's public API surface, so
-- unlike the tables above this one has no public-read policy either.
create table if not exists public.chain_cursors (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null check (chain_id > 0),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  event_name text not null check (char_length(event_name) > 0),
  last_processed_block bigint not null default 0 check (last_processed_block >= 0),
  updated_at timestamptz not null default now(),
  unique (chain_id, contract_address, event_name)
);

drop trigger if exists chain_cursors_set_updated_at on public.chain_cursors;
create trigger chain_cursors_set_updated_at
  before update on public.chain_cursors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- auth_challenges
-- ---------------------------------------------------------------------------
-- Ephemeral wallet-signature nonces for operator sign-in
-- (`02-Hackathon-PRD.md` §14). Pre-authentication and security-sensitive by
-- nature, so — like chain_cursors — this has no public-read policy; unlike
-- chain_cursors it is not even informational, so it gets no policy at all.
create table if not exists public.auth_challenges (
  id uuid primary key default gen_random_uuid(),
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  nonce_hash text not null check (nonce_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (nonce_hash),
  check (used_at is null or used_at >= created_at)
);

create index if not exists auth_challenges_address_idx on public.auth_challenges (address);
create index if not exists auth_challenges_expires_at_idx on public.auth_challenges (expires_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.enrollments enable row level security;
alter table public.demo_runs enable row level security;
alter table public.intents enable row level security;
alter table public.executions enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.chain_cursors enable row level security;
alter table public.auth_challenges enable row level security;

-- Public evidence tables: readable by anyone (`02-Hackathon-PRD.md` §12/§14
-- — "Public: readiness summary, runs, intents, incidents, and evidence").
-- No insert/update/delete policy is granted on any of them: every write goes
-- through the API server's service_role client, which bypasses RLS after
-- independently checking the operator's wallet signature. This is
-- intentional default-deny for anon/authenticated writes, not RLS turned
-- off — `service_role` is the only role that can ever write these tables.
drop policy if exists enrollments_select_public on public.enrollments;
create policy enrollments_select_public
  on public.enrollments for select
  using (true);

drop policy if exists demo_runs_select_public on public.demo_runs;
create policy demo_runs_select_public
  on public.demo_runs for select
  using (true);

drop policy if exists intents_select_public on public.intents;
create policy intents_select_public
  on public.intents for select
  using (true);

drop policy if exists executions_select_public on public.executions;
create policy executions_select_public
  on public.executions for select
  using (true);

drop policy if exists incidents_select_public on public.incidents;
create policy incidents_select_public
  on public.incidents for select
  using (true);

drop policy if exists incident_events_select_public on public.incident_events;
create policy incident_events_select_public
  on public.incident_events for select
  using (true);

-- chain_cursors and auth_challenges: RLS is enabled above with NO policies
-- created for them at all, which — per Postgres RLS semantics — denies
-- every row to every role except `service_role` (BYPASSRLS). This is a
-- deliberate default-deny, not an oversight.
