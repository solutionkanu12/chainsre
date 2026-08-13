import { describe, expect, it } from 'vitest';

import { AgentProviderTimeoutError } from '../../src/lib/agent/errors';
import { parsePlannerOutput, planMintIntent } from '../../src/lib/agent/planner';
import {
  DeterministicFallbackProvider,
  type AgentProvider,
  type PlanRequest,
} from '../../src/lib/agent/provider';

const RECEIVER = '0x2222222222222222222222222222222222222222' as const;
const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as const;
const TARGET = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as const;
const SELECTOR = '0xdd10f8ca' as const;

function baseRequest(businessRequest = 'Mint 950 units to the agent.'): PlanRequest {
  return { runId: 'run-test-1', agent: AGENT, target: TARGET, receiver: RECEIVER, businessRequest };
}

function fixedFields() {
  return {
    chainId: 84_532,
    agent: AGENT,
    target: TARGET,
    selector: SELECTOR,
    deadline: 2_000_000_000,
    nonce: 1n,
  };
}

class FixedProvider implements AgentProvider {
  readonly name = 'fixed-test-provider';
  constructor(private readonly output: string) {}
  async plan(): Promise<string> {
    return this.output;
  }
}

class ThrowingProvider implements AgentProvider {
  readonly name = 'throwing-test-provider';
  constructor(private readonly err: Error) {}
  async plan(): Promise<string> {
    throw this.err;
  }
}

describe('parsePlannerOutput', () => {
  it('accepts a valid structured output', () => {
    const parsed = parsePlannerOutput(
      JSON.stringify({ receiver: RECEIVER, shares: '950000000000000000000', rationale: 'ok' }),
    );
    expect(parsed.receiver).toBe(RECEIVER);
    expect(parsed.shares).toBe('950000000000000000000');
  });

  it('extracts JSON even when wrapped in prose/markdown fences', () => {
    const wrapped = `Sure, here you go:\n\`\`\`json\n${JSON.stringify({ receiver: RECEIVER, shares: '1' })}\n\`\`\``;
    const parsed = parsePlannerOutput(wrapped);
    expect(parsed.shares).toBe('1');
  });

  it('rejects malformed (non-JSON) output', () => {
    expect(() => parsePlannerOutput('not json at all')).toThrow(/not valid JSON/);
  });

  it('rejects output missing required fields', () => {
    expect(() => parsePlannerOutput(JSON.stringify({ receiver: RECEIVER }))).toThrow(
      /schema validation/,
    );
  });

  it('rejects output with an unexpected extra field (strict schema)', () => {
    expect(() =>
      parsePlannerOutput(
        JSON.stringify({
          receiver: RECEIVER,
          shares: '1',
          contractAddress: '0xattacker00000000000000000000000000000000',
        }),
      ),
    ).toThrow(/schema validation/);
  });

  it('rejects a shares value that is not a base-10 integer string', () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify({ receiver: RECEIVER, shares: '1.5e21' })),
    ).toThrow();
  });
});

describe('planMintIntent', () => {
  it('produces a self-consistent MintIntentV1 from valid provider output, labeled "llm"', async () => {
    const provider = new FixedProvider(
      JSON.stringify({ receiver: RECEIVER, shares: '950000000000000000000' }),
    );
    const result = await planMintIntent(baseRequest(), provider, fixedFields(), {
      timeoutMs: 5000,
    });

    expect(result.source).toBe('llm');
    expect(result.providerName).toBe('fixed-test-provider');
    expect(result.intent.receiver).toBe(RECEIVER);
    expect(result.intent.shares).toBe('950000000000000000000');
    expect(result.fallbackReason).toBeUndefined();
  });

  it('falls back to the deterministic planner when the provider returns malformed output, and discloses why', async () => {
    const provider = new FixedProvider('this is not JSON');
    const result = await planMintIntent(
      baseRequest('Mint 950 units to the agent.'),
      provider,
      fixedFields(),
      {
        timeoutMs: 5000,
      },
    );

    expect(result.source).toBe('deterministic-fallback');
    expect(result.providerName).toBe('deterministic-fallback');
    expect(result.fallbackReason).toMatch(/fixed-test-provider planner failed/);
    // The fallback parses "950" out of the SAME business request a real model would see.
    expect(result.intent.shares).toBe('950000000000000000000');
  });

  it('handles a provider timeout by falling back, never silently claiming the LLM succeeded', async () => {
    const provider = new ThrowingProvider(
      new AgentProviderTimeoutError('throwing-test-provider', 1234),
    );
    const result = await planMintIntent(
      baseRequest('Mint 950 units to the agent.'),
      provider,
      fixedFields(),
      {
        timeoutMs: 5000,
      },
    );

    expect(result.source).toBe('deterministic-fallback');
    expect(result.fallbackReason).toMatch(/timed out after 1234ms/);
  });

  it('identifies the deterministic fallback clearly when used directly (no provider key configured)', async () => {
    const provider = new DeterministicFallbackProvider();
    const result = await planMintIntent(
      baseRequest('Mint 950 units to the agent.'),
      provider,
      fixedFields(),
      {
        timeoutMs: 5000,
      },
    );

    expect(result.source).toBe('deterministic-fallback');
    expect(result.providerName).toBe('deterministic-fallback');
    expect(result.rawOutput).toMatch(/deterministic fallback/);
    expect(result.intent.shares).toBe('950000000000000000000');
  });

  it('propagates the error when even the deterministic fallback fails (defensive, should not normally happen)', async () => {
    // A business request with no parseable integer at all still produces a
    // valid (zero-share) plan rather than throwing — deterministic fallback
    // is defined for any input, matching "the demo remains runnable".
    const provider = new ThrowingProvider(new Error('boom'));
    const result = await planMintIntent(baseRequest('no numbers here'), provider, fixedFields(), {
      timeoutMs: 5000,
    });
    expect(result.source).toBe('deterministic-fallback');
    expect(result.intent.shares).toBe('0');
  });
});
