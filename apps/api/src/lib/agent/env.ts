/**
 * Agent-provider configuration, loaded separately from `keeperhub/env.ts` /
 * `chain/env.ts` / `watcher/env.ts` — matching the project's per-concern env
 * module pattern.
 *
 * No default model id is guessed here: if a provider is selected, its API
 * key AND model must both be supplied explicitly. Getting a model string
 * wrong should fail loudly at startup, not silently at the first request.
 *
 * When neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set, ChainSRE
 * runs on the disclosed deterministic fallback planner (`agent/provider.ts`)
 * so the demo stays runnable without any LLM credential.
 */
import { parseEnv } from '@chainsre/shared/env';
import { z } from 'zod';

const agentEnvSchema = z.object({
  /** Forces a specific provider; otherwise auto-selected from whichever key is present. */
  AGENT_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
  ANTHROPIC_API_KEY: z.string().min(8).optional(),
  OPENAI_API_KEY: z.string().min(8).optional(),
  /** Required together with its matching API key — no guessed default. */
  AGENT_MODEL: z.string().min(1).optional(),
  /** Bounded wait for a single planner call. */
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;

export function loadAgentEnv(source?: Record<string, string | undefined>): AgentEnv {
  return parseEnv(agentEnvSchema, source ? { source } : {});
}
