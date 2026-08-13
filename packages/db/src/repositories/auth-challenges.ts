import { RepositoryError, type DbClient } from '../client';
import type { AuthChallenge } from '../types';

export interface CreateAuthChallengeInput {
  address: string;
  nonce_hash: string;
  expires_at: string;
}

export async function createAuthChallenge(
  db: DbClient,
  input: CreateAuthChallengeInput,
): Promise<AuthChallenge> {
  const { data, error } = await db
    .from('auth_challenges')
    .insert({
      address: input.address.toLowerCase(),
      nonce_hash: input.nonce_hash.toLowerCase(),
      expires_at: input.expires_at,
    })
    .select('*')
    .maybeSingle();
  if (error || !data) throw new RepositoryError('failed to create auth challenge', error);
  return data as AuthChallenge;
}

/**
 * Atomically consume a challenge: only succeeds once, and only before
 * expiry. Returns `null` (never throws) when the nonce is unknown, already
 * used, or expired — all three are "this challenge cannot be used", and the
 * caller (signature verification) should reject with the same generic
 * failure regardless of which, so as not to leak which case applied.
 */
export async function consumeAuthChallenge(
  db: DbClient,
  nonceHash: string,
): Promise<AuthChallenge | null> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('auth_challenges')
    .update({ used_at: now })
    .eq('nonce_hash', nonceHash.toLowerCase())
    .is('used_at', null)
    .gt('expires_at', now)
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to consume auth challenge', error);
  return (data as AuthChallenge | null) ?? null;
}
