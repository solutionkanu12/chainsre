/**
 * Typed agent-provider errors, matching the KeeperHub error pattern
 * (`keeperhub/errors.ts`): callers branch on `instanceof`, never on parsing
 * `.message`. Nothing here ever carries an API key or raw prompt text.
 */

export class AgentProviderError extends Error {
  readonly providerName: string;
  constructor(message: string, providerName: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'AgentProviderError';
    this.providerName = providerName;
  }
}

/** The provider call exceeded its bounded timeout. */
export class AgentProviderTimeoutError extends AgentProviderError {
  constructor(providerName: string, timeoutMs: number) {
    super(`${providerName} planner call timed out after ${timeoutMs}ms`, providerName);
    this.name = 'AgentProviderTimeoutError';
  }
}

/**
 * Model output failed strict Zod validation — untrusted input, always
 * rejected rather than repaired or coerced. Carries the raw text so a caller
 * can log it (never the prompt or any secret), never carries a parsed
 * partial result.
 */
export class PlannerOutputInvalidError extends Error {
  readonly rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = 'PlannerOutputInvalidError';
    this.rawOutput = rawOutput;
  }
}

/** A tool received input that failed its strict schema, or referenced state outside its authority. */
export class UnsafeToolRequestError extends Error {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`unsafe request to tool "${tool}": ${message}`);
    this.name = 'UnsafeToolRequestError';
    this.tool = tool;
  }
}
