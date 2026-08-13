import { RepositoryError, type DbClient } from '../client';
import type { ChainCursor } from '../types';

/**
 * `chain_cursors.last_processed_block` is a SQL `bigint` — safe up to 2^53
 * for any realistic block number, but PostgREST still serializes it as a
 * bare JSON number on the wire, not a string. Normalize it back to the
 * `string` shape {@link ChainCursor} declares (matching every other
 * on-chain-integer field in this codebase — `nonce`, `gas_used_wei`,
 * `shares`) so callers never have to special-case this one column.
 */
function normalizeCursor(row: Record<string, unknown>): ChainCursor {
  return { ...row, last_processed_block: String(row.last_processed_block) } as ChainCursor;
}

export async function getChainCursor(
  db: DbClient,
  chainId: number,
  contractAddress: string,
  eventName: string,
): Promise<ChainCursor | null> {
  const { data, error } = await db
    .from('chain_cursors')
    .select('*')
    .eq('chain_id', chainId)
    .eq('contract_address', contractAddress.toLowerCase())
    .eq('event_name', eventName)
    .maybeSingle();
  if (error) throw new RepositoryError('failed to read chain cursor', error);
  return data ? normalizeCursor(data as Record<string, unknown>) : null;
}

export interface UpsertChainCursorInput {
  chain_id: number;
  contract_address: string;
  event_name: string;
  last_processed_block: string;
}

/** Create-or-update a cursor. Idempotent by design — the watcher calls this after every batch. */
export async function upsertChainCursor(
  db: DbClient,
  input: UpsertChainCursorInput,
): Promise<ChainCursor> {
  const { data, error } = await db
    .from('chain_cursors')
    .upsert(
      {
        chain_id: input.chain_id,
        contract_address: input.contract_address.toLowerCase(),
        event_name: input.event_name,
        last_processed_block: input.last_processed_block,
      },
      { onConflict: 'chain_id,contract_address,event_name' },
    )
    .select('*')
    .maybeSingle();
  if (error || !data) throw new RepositoryError('failed to upsert chain cursor', error);
  return normalizeCursor(data as Record<string, unknown>);
}
