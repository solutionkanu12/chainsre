/**
 * Minimal HS256 JWT signer. PostgREST verifies the incoming token itself and
 * uses the `role` claim to `SET ROLE` for the request and exposes every
 * claim via `current_setting('request.jwt.claims', true)`, which is exactly
 * what the `auth.uid()`/`auth.role()` shim functions read — the same
 * mechanism the real Supabase platform uses in production, reproduced here
 * against a bare PostgREST instead of the full platform.
 *
 * No third-party JWT library needed for three fixed claim shapes: a JWT is
 * `base64url(header) + "." + base64url(payload) + "." + base64url(HMAC-SHA256)`.
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
