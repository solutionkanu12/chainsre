/**
 * Turns an `AgentProvider`'s raw, untrusted text into a fully-formed,
 * self-consistent `MintIntentV1` (`03-System-Architecture.md` §8):
 *
 *  1. Ask the provider to plan — it returns text, nothing more.
 *  2. Strictly validate that text against {@link plannerOutputSchema}. Any
 *     deviation (extra field, wrong type, non-JSON, markdown fences, prose)
 *     is REJECTED, never repaired or coerced.
 *  3. On any failure — provider timeout/error, or invalid output — fall back
 *     to the disclosed deterministic planner and retry validation. The
 *     result always honestly reports which path produced it
 *     (`source`/`providerName`); a fallback is never labeled as if a real
 *     model had produced it.
 *  4. Combine the validated `{ receiver, shares }` with orchestrator-supplied,
 *     non-model-derived fields (chainId, agent, target, selector, deadline,
 *     nonce) into the canonical intent via the shared hash builder, so the
 *     `intentId` this planner emits is always the true hash of its own body.
 */
import { buildMintIntent, type MintIntentHashInput } from '@chainsre/shared/intent-hash';
import type { MintIntentV1 } from '@chainsre/shared/schemas';

import { PlannerOutputInvalidError } from './errors';
import {
  DeterministicFallbackProvider,
  type AgentProvider,
  type PlanCallOptions,
  type PlanRequest,
} from './provider';
import { plannerOutputSchema, type PlannerOutput } from './schemas';

/** Best-effort extraction of a JSON object from text that may include prose/markdown fences around it. */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

/**
 * Strictly parse and validate planner output. Never throws anything other
 * than {@link PlannerOutputInvalidError} — every failure mode (malformed
 * JSON, schema violation) collapses to the same typed, safely-loggable error.
 */
export function parsePlannerOutput(raw: string): PlannerOutput {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    throw new PlannerOutputInvalidError(
      `planner output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    );
  }
  const result = plannerOutputSchema.safeParse(json);
  if (!result.success) {
    throw new PlannerOutputInvalidError(
      `planner output failed schema validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      raw,
    );
  }
  return result.data;
}

export type PlannerSource = 'llm' | 'deterministic-fallback';

export interface PlannerResult {
  readonly intent: MintIntentV1;
  readonly source: PlannerSource;
  readonly providerName: string;
  readonly rawOutput: string;
  /** Set only when a configured real provider failed and the fallback recovered the run. */
  readonly fallbackReason?: string;
}

/** Fields the orchestrator supplies deterministically — never derived from any model output. */
export type MintIntentFixedFields = Omit<MintIntentHashInput, 'receiver' | 'shares'>;

export async function planMintIntent(
  request: PlanRequest,
  provider: AgentProvider,
  fixedFields: MintIntentFixedFields,
  options: PlanCallOptions,
): Promise<PlannerResult> {
  const attempt = async (p: AgentProvider): Promise<{ output: PlannerOutput; raw: string }> => {
    const raw = await p.plan(request, options);
    const output = parsePlannerOutput(raw);
    return { output, raw };
  };

  let providerUsed = provider;
  let fallbackReason: string | undefined;
  let result: { output: PlannerOutput; raw: string };
  try {
    result = await attempt(provider);
  } catch (err) {
    if (provider.name === 'deterministic-fallback') {
      throw err;
    }
    fallbackReason = `${provider.name} planner failed (${err instanceof Error ? err.message : String(err)}) — recovered with the deterministic fallback`;
    providerUsed = new DeterministicFallbackProvider();
    result = await attempt(providerUsed);
  }

  const intent = buildMintIntent({
    ...fixedFields,
    receiver: result.output.receiver,
    shares: result.output.shares,
  });

  return {
    intent,
    source: providerUsed.name === 'deterministic-fallback' ? 'deterministic-fallback' : 'llm',
    providerName: providerUsed.name,
    rawOutput: result.raw,
    fallbackReason,
  };
}
