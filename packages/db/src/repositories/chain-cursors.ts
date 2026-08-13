import { RepositoryError, type DbClient } from '../client';
import type { ChainCursor } from '../types';

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
  return data as ChainCursor | null;
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
  return data as ChainCursor;
}
