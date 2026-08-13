import { InvalidStateTransitionError, RepositoryError, type DbClient } from '../client';
import type { Intent } from '../types';

export interface CreateIntentInput {
  run_id: string;
  agent_address: string;
  chain_id: number;
  target_address: string;
  selector: string;
  params: Record<string, unknown>;
  params_hash: string;
  intent_hash: string;
  /** uint64, decimal string — never a JS number. */
  nonce: string;
  /** Unix seconds. */
  deadline: number;
}

export async function createIntent(db: DbClient, input: CreateIntentInput): Promise<Intent> {
  const { data, error } = await db
    .from('intents')
    .insert({
      ...input,
      agent_address: input.agent_address.toLowerCase(),
      target_address: input.target_address.toLowerCase(),
      selector: input.selector.toLowerCase(),
      params_hash: input.params_hash.toLowerCase(),
      intent_hash: input.intent_hash.toLowerCase(),
    })
    .select('*')
    .maybeSingle();
  if (error || !data) throw new RepositoryError('failed to create intent', error);
  return data as Intent;
}

export async function getIntent(db: DbClient, id: string): Promise<Intent | null> {
  const { data, error } = await db.from('intents').select('*').eq('id', id).maybeSingle();
  if (error) throw new RepositoryError('failed to read intent', error);
  return data as Intent | null;
}

export async function getIntentByHash(db: DbClient, intentHash: string): Promise<Intent | null> {
  const { data, error } = await db
    .from('intents')
    .select('*')
    .eq('intent_hash', intentHash.toLowerCase())
    .maybeSingle();
  if (error) throw new RepositoryError('failed to read intent by hash', error);
  return data as Intent | null;
}

async function transitionIntent(
  db: DbClient,
  id: string,
  to: 'committed' | 'commit_failed' | 'expired',
  validFrom: readonly string[],
): Promise<Intent> {
  const { data, error } = await db
    .from('intents')
    .update({ status: to })
    .eq('id', id)
    .in('status', validFrom)
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to transition intent', error);
  if (data) return data as Intent;

  const current = await getIntent(db, id);
  throw new InvalidStateTransitionError(id, to, current?.status);
}

export function markIntentCommitted(db: DbClient, id: string): Promise<Intent> {
  return transitionIntent(db, id, 'committed', ['pending']);
}

export function markIntentCommitFailed(db: DbClient, id: string): Promise<Intent> {
  return transitionIntent(db, id, 'commit_failed', ['pending']);
}

export function markIntentExpired(db: DbClient, id: string): Promise<Intent> {
  return transitionIntent(db, id, 'expired', ['pending']);
}
