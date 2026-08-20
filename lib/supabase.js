/**
 * lib/supabase.js — Single canonical Supabase client for the entire backend.
 * Import from here everywhere. Never instantiate createClient() elsewhere.
 */
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('💥 CRITICAL: SUPABASE_URL or SUPABASE_ANON_KEY missing from .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * createRequestClient(accessToken) — per-request Supabase client seeded with
 * the caller's verified JWT, so auth.uid() resolves inside Postgres/RLS for
 * that request. Still the anon key — no service-role key is introduced.
 */
export function createRequestClient(accessToken) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * mintSystemToken(tenantId) — signs a short-lived JWT for trusted backend
 * code (background workers, webhook handlers) that has already resolved
 * which tenant it's acting for but has no real user session to attach.
 *
 * Signed with the project's own SUPABASE_JWT_SECRET (the same secret that
 * signs real user session tokens), so PostgREST/Postgres verify it exactly
 * like any other JWT — no service-role key, no RLS bypass. `app_tenant_id`
 * is read by auth_tenant_id() (see phase_d_2 migration) as a fallback when
 * there's no real auth.uid(); `sub` is omitted on purpose so auth.uid()
 * itself stays NULL (Postgres's auth.uid() casts a present `sub` to uuid,
 * so a placeholder value would risk colliding with or reserving a UUID —
 * omission is a strictly safer no-op).
 */
export function mintSystemToken(tenantId) {
  if (!jwtSecret) {
    throw new Error('💥 CRITICAL: SUPABASE_JWT_SECRET missing from .env.local — required to mint system tokens');
  }
  if (!tenantId) {
    throw new Error('mintSystemToken requires a tenantId');
  }
  return jwt.sign(
    { role: 'authenticated', app_tenant_id: tenantId, purpose: 'system-worker' },
    jwtSecret,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
}

/**
 * createSystemClient(tenantId) — Supabase client for trusted backend code
 * with no user session, scoped to one already-resolved tenant. Use this
 * instead of the shared `supabase` singleton in background workers/webhook
 * handlers so RLS enforces tenant scoping the same way it does for real
 * authenticated requests, instead of relying on the dev-fallback OR-branch.
 */
export function createSystemClient(tenantId) {
  return createRequestClient(mintSystemToken(tenantId));
}
