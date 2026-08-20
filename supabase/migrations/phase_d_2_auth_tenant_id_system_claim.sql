-- phase_d_2_auth_tenant_id_system_claim
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Phase D, step 2 — the RLS-side half of the background-worker trust
-- mechanism (step 1 was phase_d_1_whatsapp_sessions_tenant_id_uuid, an
-- unrelated prerequisite type fix). App-code half: `mintSystemToken` /
-- `createSystemClient` added to lib/supabase.js in the same change set.
--
-- BACKGROUND: seven background workers/webhooks (WhatsApp ingestion,
-- WhatsApp Meta webhook, email webhook, IMAP polling, form webhook,
-- autoReplySweeper, followUpEngine, digest preview/send) currently use the
-- shared anon-key `supabase` client with no user JWT, so `auth.uid()` (and
-- therefore `auth_tenant_id()`) always evaluates to NULL for them — they
-- only pass RLS today via the `OR <dev-fallback-tenant>` literal branch
-- present on every scoped policy. cto-ai and security-lead were both
-- consulted on the replacement design (2026-08-20) and converged on a
-- synthetic tenant-scoped JWT over a service-role client: RLS stays the
-- actual enforcement boundary for these code paths too, rather than
-- shifting correctness onto hand-written WHERE clauses with no RLS
-- backstop. Full reasoning in that session's transcript / DB_AUDIT_REPORT
-- Section 24-25.
--
-- WHAT THIS DOES: extends `auth_tenant_id()` to fall back to a JWT claim,
-- `app_tenant_id`, when the normal `user_tenants` lookup (keyed off
-- `auth.uid()`) resolves to NULL. `app_tenant_id` is only ever present on
-- a token minted by `mintSystemToken()` (lib/supabase.js) — signed with
-- the project's own `SUPABASE_JWT_SECRET`, the same secret that signs real
-- user session tokens. PostgREST verifies that signature before
-- `request.jwt.claims` is ever populated, so this claim cannot be forged
-- by an anon caller; only backend code that holds `SUPABASE_JWT_SECRET`
-- can produce a token this function will honor. This is the same trust
-- model `auth.uid()` itself already relies on for the `sub` claim — no new
-- trust boundary is introduced, just a second claim read from the same
-- verified source.
--
-- WHY THIS IS SAFER THAN A SERVICE-ROLE CLIENT: a service-role client
-- bypasses RLS entirely for every query it issues — correctness would
-- depend on every worker's hand-written WHERE clause being right, with no
-- database-level backstop, in code paths (WhatsApp/email ingestion) that
-- fire on every inbound message with no human review. This approach keeps
-- every query — worker or user — subject to the exact same RLS policy.
--
-- WHY THE DEV-FALLBACK OR-BRANCH IS NOT REMOVED HERE: that removal is its
-- own separately reviewed migration (tracked as a later Phase D step),
-- gated on (a) all 7 workers actually migrated onto `createSystemClient`
-- and (b) a real second-tenant cross-tenant isolation test passing. Adding
-- the new mechanism and removing the old one in the same migration would
-- make a failed cutover harder to diagnose and roll back cleanly.
--
-- Rollback: re-apply the exact function body from phase_1_12b (reproduced
-- below), which drops the `app_tenant_id` fallback and reverts to the
-- user_tenants-only lookup. Safe to run standalone — nothing else in this
-- migration is touched by it.
--
-- ROLLBACK (commented out — for reference only):
--
-- CREATE OR REPLACE FUNCTION public.auth_tenant_id()
-- RETURNS uuid
-- LANGUAGE sql
-- STABLE SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $function$
--   SELECT tenant_id
--   FROM public.user_tenants
--   WHERE user_id = auth.uid()
--   ORDER BY created_at ASC, id ASC
--   LIMIT 1;
-- $function$;

CREATE OR REPLACE FUNCTION public.auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (
      SELECT tenant_id
      FROM public.user_tenants
      WHERE user_id = auth.uid()
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    ),
    NULLIF(
      current_setting('request.jwt.claims', true)::json ->> 'app_tenant_id',
      ''
    )::uuid
  );
$function$;

-- Grants are unchanged by this migration — still anon/authenticated/
-- service_role/postgres from phase_1_12b. System tokens carry
-- `role: authenticated`, so they run under the `authenticated` grant,
-- already EXECUTE-able. No grant change needed here.
