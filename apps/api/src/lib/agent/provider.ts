/**
 * Provider-neutral planner interface. `agent/planner.ts` calls exactly this
 * interface — it has no idea whether the concrete implementation is
 * Anthropic, OpenAI, or the deterministic fallback, and none of them is
 * hard-wired anywhere else in the codebase.
 *
 * Every implementation returns raw, UNTRUSTED text. Nothing here parses or
 * trusts that text as a `MintIntentV1` — `planner.ts` is solely responsible
 * for strict Zod validation before anything derived from it ever reaches a
 * tool. A provider never sees more than the public, non-secret planning
 * context (`PlanRequest`) — no API keys, no DB contents, no KeeperHub
 * credentials are ever placed in a prompt.
 */
import type { Hex } from 'viem';

import { AgentProviderTimeoutError, AgentProviderError } from './errors';
import type { AgentEnv } from './env';

export interface PlanRequest {
  /** Traceability only — never influences the target contract or amount. */
  readonly runId: string;
  readonly agent: Hex;
  readonly target: Hex;
  readonly receiver: Hex;
  /**
   * The natural-language business ask the planner must translate into a
   * structured `{ receiver, shares }`. Deliberately the ONLY thing that
   * varies planner output — everything else in the eventual `MintIntentV1`
   * (chainId, selector, deadline, nonce, target) is supplied deterministically
   * by the orchestrator, never by the model.
   */
  readonly businessRequest: string;
}

export interface PlanCallOptions {
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AgentProvider {
  readonly name: string;
  /** Returns raw, untrusted text. Never throws for "the model said something odd" — only for transport/timeout failures. */
  plan(request: PlanRequest, options: PlanCallOptions): Promise<string>;
}

const SYSTEM_PROMPT = [
  'You are a planning component inside an audited on-chain agent system.',
  'You NEVER execute anything — you only propose the parameters of ONE typed mint intent.',
  'Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly:',
  '{"receiver":"0x...40-hex-chars","shares":"<base-10 integer string, 18 decimals>","rationale":"<one short sentence>"}',
  '"shares" MUST be the exact integer number of base units (multiply whole-token amounts by 10^18) as a decimal string — never scientific notation, never a JSON number.',
].join('\n');

function userPrompt(request: PlanRequest): string {
  return [
    `Business request: ${request.businessRequest}`,
    `The receiver MUST be exactly: ${request.receiver}`,
    `Respond with the JSON object described in your instructions and nothing else.`,
  ].join('\n');
}

async function withTimeout<T>(
  providerName: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AgentProviderTimeoutError(providerName, timeoutMs);
    }
    throw new AgentProviderError(
      `${providerName} planner call failed: ${err instanceof Error ? err.message : String(err)}`,
      providerName,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Anthropic Messages API. Requires `ANTHROPIC_API_KEY` and an explicit `AGENT_MODEL`. */
export class AnthropicProvider implements AgentProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(env: Pick<AgentEnv, 'ANTHROPIC_API_KEY' | 'AGENT_MODEL'>) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AnthropicProvider requires ANTHROPIC_API_KEY');
    if (!env.AGENT_MODEL) throw new Error('AnthropicProvider requires AGENT_MODEL');
    this.apiKey = env.ANTHROPIC_API_KEY;
    this.model = env.AGENT_MODEL;
  }

  async plan(request: PlanRequest, options: PlanCallOptions): Promise<string> {
    return withTimeout(this.name, options.timeoutMs, async (signal) => {
      const fetchImpl = options.fetchImpl ?? fetch;
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt(request) }],
        }),
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new AgentProviderError(`Anthropic API returned HTTP ${res.status}`, this.name);
      }
      const content = Array.isArray(data.content) ? data.content : [];
      const text = content.find(
        (block): block is { type: string; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'text',
      )?.text;
      if (typeof text !== 'string') {
        throw new AgentProviderError('Anthropic response contained no text block', this.name);
      }
      return text;
    });
  }
}

/** Any OpenAI-chat-completions-compatible API. Requires `OPENAI_API_KEY` and an explicit `AGENT_MODEL`. */
export class OpenAIProvider implements AgentProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(env: Pick<AgentEnv, 'OPENAI_API_KEY' | 'AGENT_MODEL'>) {
    if (!env.OPENAI_API_KEY) throw new Error('OpenAIProvider requires OPENAI_API_KEY');
    if (!env.AGENT_MODEL) throw new Error('OpenAIProvider requires AGENT_MODEL');
    this.apiKey = env.OPENAI_API_KEY;
    this.model = env.AGENT_MODEL;
  }

  async plan(request: PlanRequest, options: PlanCallOptions): Promise<string> {
    return withTimeout(this.name, options.timeoutMs, async (signal) => {
      const fetchImpl = options.fetchImpl ?? fetch;
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(request) },
          ],
        }),
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new AgentProviderError(`OpenAI API returned HTTP ${res.status}`, this.name);
      }
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const text = (choices[0] as { message?: { content?: unknown } } | undefined)?.message
        ?.content;
      if (typeof text !== 'string') {
        throw new AgentProviderError('OpenAI response contained no message content', this.name);
      }
      return text;
    });
  }
}

/**
 * Disclosed, deterministic, non-LLM planner. Extracts the leading whole-token
 * amount from `businessRequest` (e.g. "950" from "...950 units...") and
 * multiplies by 10^18 — the SAME translation a real model is instructed to
 * perform, done here with a fixed rule instead of a model call, so the demo
 * remains runnable with zero LLM credentials and its output is fully
 * reproducible. Never silently substituted for a configured real provider on
 * success — only used when no provider key is configured, or as an
 * explicitly-labeled recovery path when a configured provider fails
 * (`planner.ts` always reports which one actually produced the result).
 */
export class DeterministicFallbackProvider implements AgentProvider {
  readonly name = 'deterministic-fallback';

  async plan(request: PlanRequest): Promise<string> {
    const match = /(\d+)/.exec(request.businessRequest);
    const wholeUnits = BigInt(match?.[1] ?? '0');
    const shares = (wholeUnits * 10n ** 18n).toString();
    return JSON.stringify({
      receiver: request.receiver,
      shares,
      rationale: `deterministic fallback: parsed ${wholeUnits} whole units from the business request (no LLM provider configured or available)`,
    });
  }
}

/**
 * Select a provider from configuration. `AGENT_PROVIDER` forces a choice
 * (throws if its key is missing); otherwise the first configured key wins;
 * with no key configured at all, the deterministic fallback is selected —
 * disclosed via its own `name`, never disguised as an LLM.
 */
export function loadAgentProvider(env: AgentEnv): AgentProvider {
  if (env.AGENT_PROVIDER === 'anthropic') return new AnthropicProvider(env);
  if (env.AGENT_PROVIDER === 'openai') return new OpenAIProvider(env);
  if (env.ANTHROPIC_API_KEY && env.AGENT_MODEL) return new AnthropicProvider(env);
  if (env.OPENAI_API_KEY && env.AGENT_MODEL) return new OpenAIProvider(env);
  return new DeterministicFallbackProvider();
}
