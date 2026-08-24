-- phase_i_2_resolve_brand_id_for_whatsapp_phone_id
--
-- APPLIED 2026-08-24 via the Supabase MCP `apply_migration` tool, version
-- `20260824094810`. Reviewed by security-lead and database-lead (two
-- rounds each — see DB_AUDIT_REPORT.md Section 42 for full detail).
--
-- Companion to phase_i_1 (per-tenant WhatsApp session isolation,
-- 2026-08-23). controllers/whatsapp.js's Meta Cloud API inbound webhook
-- used to hardcode brand id `1` for every tenant's message — fixed by
-- resolving the real tenant from the webhook payload's own
-- `phone_number_id`. The first version of that fix queried `tenants` (to
-- match `whatsapp_phone_id`) and `brand_dna` (to get the brand id) via the
-- plain anon-key `supabase` singleton — security-lead caught, and verified
-- LIVE against this project, that this always fails: `tenants`' only
-- policy is `tenants_tenant_select USING (id = auth_tenant_id())`, and
-- `anon`'s EXECUTE on `auth_tenant_id()` was already revoked as part of
-- Phase D hardening (phase_d_3). Every anon-client call errors at the RLS
-- layer, `resolveBrandIdForPhoneNumberId` always returns null, and the
-- webhook handler always hits its new `console.warn(...); return;` branch —
-- turning "every message misattributed to brand 1" into "every Meta Cloud
-- API message silently dropped," a regression, not a fix.
--
-- This is the same shape of problem phase_i_1's get_active_whatsapp_sessions()
-- already solves: a backend lookup with no single legitimate tenant caller
-- (the whole point of the call IS to discover which tenant owns this phone
-- number — there's no tenant_id yet to scope a normal createSystemClient()
-- read by). Reopening anon SELECT on `tenants` to fix this is explicitly
-- NOT the answer — that access was deliberately closed as a live PII leak
-- (phase_1_14_drop_tenants_open_select_policy.sql) and must stay closed.
--
-- Same fix shape as phase_i_1: a SECURITY DEFINER RPC, gated on
-- mintSystemToken()'s `purpose: 'system-worker'` JWT claim (lib/supabase.js)
-- so only backend-minted system tokens get real data back — any real user
-- session (no `purpose` claim) or unauthenticated anon caller gets an
-- empty result, regardless of what EXECUTE grants end up applying via
-- Postgres's default ACL. Explicit REVOKE included this time (phase_i_1
-- was reviewed and found missing one — folding that lesson in here rather
-- than relying on the claim gate alone, per both security-lead's and
-- database-lead's independent recommendation).
--
-- Returns only a single brand_dna.id (an integer, not tenant PII) or no
-- rows if the phone_number_id doesn't match any tenant — the caller
-- (controllers/whatsapp.js) treats "no rows" as "drop this message,
-- unrecognized number" exactly as it already does today.
--
-- Also adds a unique partial index on tenants.whatsapp_phone_id — database-
-- lead review (2026-08-23) found that column had no uniqueness constraint
-- at all. Without one, the RPC's `limit 1` above would silently return an
-- arbitrary tenant's brand_id if two tenants ever ended up sharing a
-- phone_number_id (onboarding typo, or a WhatsApp number reused/reassigned
-- later) — the exact misattribution bug this whole fix exists to close,
-- just relocated into the data layer where it'd be invisible. Only 2
-- tenants exist today and only 1 has whatsapp_phone_id set, so this is
-- zero-cleanup to add now. Partial (`where ... is not null`) so tenants who
-- haven't connected WhatsApp yet don't collide on NULL.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS resolve_brand_id_for_whatsapp_phone_id(text);
--   DROP INDEX IF EXISTS tenants_whatsapp_phone_id_key;

create or replace function resolve_brand_id_for_whatsapp_phone_id(p_phone_number_id text)
returns table (brand_id integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select b.id as brand_id
  from public.tenants t
  join public.brand_dna b on b.tenant_id = t.id
  where t.whatsapp_phone_id = p_phone_number_id
    and coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') = 'system-worker'
  limit 1;
$$;

revoke execute on function resolve_brand_id_for_whatsapp_phone_id(text) from public;
revoke execute on function resolve_brand_id_for_whatsapp_phone_id(text) from anon;
grant execute on function resolve_brand_id_for_whatsapp_phone_id(text) to authenticated;

create unique index tenants_whatsapp_phone_id_key
  on public.tenants (whatsapp_phone_id)
  where whatsapp_phone_id is not null;
