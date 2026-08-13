/**
 * Wraps `mockFetchSequence` with a side effect keyed to a specific call's
 * 1-indexed position — the only point where a test can synchronize the
 * mocked KeeperHub HTTP exchange with the fake chain's read-back state (e.g.
 * crediting `sharesOf` right after the mint's broadcast call "lands", so the
 * tool's own before/after on-chain verification sees a genuine delta).
 *
 * Call order is deterministic given a fixed control-flow path
 * (`executeContractCallSafely` always does simulate -> broadcast -> one
 * status poll when the queued status response is already terminal), so
 * indexing by call count is reliable here.
 */
import {
  mockFetchSequence,
  type RecordedCall,
  type StubResponse,
} from '../../keeperhub/_fetchStub';

export function mockFetchSequenceWithEffects(
  responses: readonly StubResponse[],
  effects: Readonly<Record<number, () => void>>,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const base = mockFetchSequence(responses);
  let callCount = 0;

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    callCount += 1;
    const res = await base.fetchImpl(input, init);
    effects[callCount]?.();
    return res;
  }) as typeof fetch;

  return { fetchImpl, calls: base.calls };
}
