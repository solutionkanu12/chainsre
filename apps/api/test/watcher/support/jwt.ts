/**
 * Minimal HS256 JWT signer. Identical to
 * `packages/db/test/integration/support/jwt.ts` — PostgREST verifies the
 * incoming token and `SET ROLE`s per its `role` claim, which the `auth.uid()`
 * / `auth.role()` shim functions read back via `request.jwt.claims`.
 */
import { createHmac } from 'node:crypto';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

export function anonJwt(secret: string): string {
  return signJwt({ role: 'anon' }, secret);
}

export function authenticatedJwt(secret: string, userId: string): string {
  return signJwt({ role: 'authenticated', sub: userId }, secret);
}

export function serviceRoleJwt(secret: string): string {
  return signJwt({ role: 'service_role' }, secret);
}
