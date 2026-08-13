/**
 * Row types mirroring the SQL migrations in `supabase/migrations`, giving the
 * API (and later the watcher/guardian) a single source of truth for every
 * table's shape.
 *
 * On-chain integers that can exceed 2^53 (shares, nonces, gas) are `text`
 * columns (constrained to a base-10 integer string) and always typed here as
 * `string` — the real runtime path is PostgREST, which serializes SQL
 * `numeric`/`bigint` as a bare JSON number, not a string, so those SQL types
 * would silently lose precision on the wire. See
 * `supabase/migrations/0002_application_data.sql`'s header comment. Never
 * coerce one of these fields to `number`.
 */

export type MembershipRole = 'owner' | 'admin' | 'member';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

/** Names of the foundation tables, useful for typed query builders. */
export const FOUNDATION_TABLES = ['profiles', 'organizations', 'organization_members'] as const;
export type FoundationTable = (typeof FOUNDATION_TABLES)[number];

// ---------------------------------------------------------------------------
// Phase 4 — application data (supabase/migrations/0002_application_data.sql)
// ---------------------------------------------------------------------------

export type EnrollmentStatus = 'active' | 'disabled';

export interface Enrollment {
  id: string;
  chain_id: number;
  contract_address: string;
  action_selector: string;
  policy_version: string;
  guardian_workflow_id: string;
  status: EnrollmentStatus;
  created_at: string;
  updated_at: string;
}

export type DemoRunMode = 'normal' | 'protected_attack' | 'control_attack';

/** The demo-run state machine, `03-System-Architecture.md` §14. */
export type DemoRunStatus =
  | 'created'
  | 'planning'
  | 'committing'
  | 'committed'
  | 'executing'
  | 'confirmed'
  | 'evaluating'
  | 'responding'
  | 'testing_containment'
  | 'completed'
  | 'planning_failed'
  | 'commit_failed'
  | 'action_failed'
  | 'detection_timeout'
  | 'containment_failed'
  | 'demo_failed';

/** Terminal states a demo run can never transition out of. */
export const DEMO_RUN_TERMINAL_STATUSES: readonly DemoRunStatus[] = [
  'completed',
  'planning_failed',
  'commit_failed',
  'action_failed',
  'detection_timeout',
  'containment_failed',
  'demo_failed',
];

/** Legal (from, to) edges of the demo-run state machine. */
export const DEMO_RUN_TRANSITIONS: Readonly<Record<DemoRunStatus, readonly DemoRunStatus[]>> = {
  created: ['planning', 'planning_failed'],
  planning: ['committing', 'planning_failed'],
  committing: ['committed', 'commit_failed'],
  committed: ['executing', 'commit_failed'],
  executing: ['confirmed', 'action_failed'],
  confirmed: ['evaluating', 'action_failed'],
  evaluating: ['responding', 'detection_timeout'],
  responding: ['testing_containment', 'containment_failed'],
  testing_containment: ['completed', 'containment_failed'],
  completed: [],
  planning_failed: [],
  commit_failed: [],
  action_failed: [],
  detection_timeout: [],
  containment_failed: [],
  demo_failed: [],
};

export interface DemoRun {
  id: string;
  mode: DemoRunMode;
  status: DemoRunStatus;
  vault_address: string;
  declared_amount: string | null;
  executed_amount: string | null;
  started_by: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type IntentStatus = 'pending' | 'committed' | 'commit_failed' | 'expired';

export interface Intent {
  id: string;
  run_id: string;
  agent_address: string;
  chain_id: number;
  target_address: string;
  selector: string;
  params: Record<string, unknown>;
  params_hash: string;
  intent_hash: string;
  /** uint64, decimal string. */
  nonce: string;
  /** Unix seconds. */
  deadline: number;
  status: IntentStatus;
  created_at: string;
}

export type ExecutionKind = 'commit' | 'action' | 'guardian' | 'drain_attempt';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Execution {
  id: string;
  run_id: string;
  intent_id: string | null;
  kind: ExecutionKind;
  provider_execution_id: string | null;
  idempotency_key: string;
  function_name: string;
  function_args: unknown[];
  status: ExecutionStatus;
  tx_hash: string | null;
  tx_link: string | null;
  block_number: number | null;
  /** uint256-scale, decimal string. */
  gas_used_wei: string | null;
  error: string | null;
  raw_receipt: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

/** The incident state machine, `03-System-Architecture.md` §14. */
export type IncidentState =
  | 'detected'
  | 'containment_queued'
  | 'containment_running'
  | 'containment_confirmed'
  | 'state_verified'
  | 'contained'
  | 'containment_failed';

export interface Incident {
  id: string;
  run_id: string;
  intent_id: string | null;
  severity: IncidentSeverity;
  state: IncidentState;
  expected: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  mismatch_fields: string[];
  action_tx_hash: string | null;
  guardian_execution_id: string | null;
  containment_locked_at: string | null;
  containment_locked_by: string | null;
  detected_at: string;
  containment_started_at: string | null;
  contained_at: string | null;
  detection_latency_ms: number | null;
  containment_latency_ms: number | null;
  created_at: string;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  sequence: number;
  type: string;
  status: string;
  message: string | null;
  evidence: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
}

export interface ChainCursor {
  id: string;
  chain_id: number;
  contract_address: string;
  event_name: string;
  /** Block number as a string — can exceed 2^53 on some chains over time. */
  last_processed_block: string;
  updated_at: string;
}

export interface AuthChallenge {
  id: string;
  address: string;
  nonce_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export const APPLICATION_TABLES = [
  'enrollments',
  'demo_runs',
  'intents',
  'executions',
  'incidents',
  'incident_events',
  'chain_cursors',
  'auth_challenges',
] as const;
export type ApplicationTable = (typeof APPLICATION_TABLES)[number];

/** Tables with a public (unauthenticated) SELECT policy. */
export const PUBLIC_READABLE_TABLES = [
  'enrollments',
  'demo_runs',
  'intents',
  'executions',
  'incidents',
  'incident_events',
] as const;

/** Tables with no anon/authenticated policy at all — service_role only. */
export const SERVICE_ROLE_ONLY_TABLES = ['chain_cursors', 'auth_challenges'] as const;
