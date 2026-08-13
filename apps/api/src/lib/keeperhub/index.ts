/**
 * KeeperHub integration surface. Server-only — never import this from
 * anything that ships to the browser (it builds `Authorization: Bearer`
 * headers from a secret key). `apps/web` has no dependency on `@chainsre/api`,
 * so that boundary holds structurally, not just by convention.
 */
export * from './env';
export * from './errors';
export * from './types';
export * from './idempotency';
export * from './polling';
export { DEFAULT_REQUEST_TIMEOUT_MS } from './http';
export * from './client';
