import { RepositoryError, type DbClient } from '../client';
import type { Enrollment } from '../types';

/** The one enrollment the product actually reads at runtime: active, by chain + contract. */
export async function getActiveEnrollment(
  db: DbClient,
  chainId: number,
  contractAddress: string,
): Promise<Enrollment | null> {
  const { data, error } = await db
    .from('enrollments')
    .select('*')
    .eq('chain_id', chainId)
    .eq('contract_address', contractAddress.toLowerCase())
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to read enrollment', error);
  return data as Enrollment | null;
}

export async function listEnrollments(db: DbClient): Promise<Enrollment[]> {
  const { data, error } = await db
    .from('enrollments')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new RepositoryError('failed to list enrollments', error);
  return (data ?? []) as Enrollment[];
}
