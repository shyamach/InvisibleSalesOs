-- phase_d_1_whatsapp_sessions_tenant_id_uuid
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Phase D — background-worker RLS trust mechanism. This is the first step
-- in that phase: closing DB_AUDIT_REPORT.md §3 item 5, deferred out of
-- scope by Block 1.11 (phase_1_11_drop_whatsapp_sessions_permissive_policy)
-- specifically so the type fix could land as its own change. Confirmed
-- live on 2026-08-20:
--   - `whatsapp_sessions.tenant_id` is `varchar(255) NOT NULL`, with a
--     UNIQUE constraint (`whatsapp_sessions_tenant_id_key`).
--   - 0 rows in the table today — no data to validate/cast, no blast
--     radius from this change.
--   - The one live policy, `whatsapp_sessions_tenant_select`, compares
--     `tenant_id` against `auth_tenant_id()` and the dev-fallback literal
--     via explicit `::text` casts on both sides, purely to work around the
--     varchar/uuid type mismatch — see phase_1_11's own comment block for
--     why that cast was chosen over a type fix at the time.
--
-- WHY THIS MATTERS FOR PHASE D: the trusted-caller JWT mechanism Phase D
-- introduces will attach a `tenant_id` uuid claim, verified against real
-- uuid columns. Leaving one scoped table on varchar comparison-via-cast
-- would be an inconsistency in an area we're specifically hardening right
-- now — cheap to fix while the table is still empty, expensive to leave
-- for later once real WhatsApp pairing rows exist.
--
-- WHAT THIS DOES: converts the column type varchar → uuid (trivial given
-- 0 rows — `USING tenant_id::uuid` has nothing to cast), then replaces
-- `whatsapp_sessions_tenant_select` with an equivalent policy using a
-- plain uuid comparison (no casts). The dev-fallback OR-branch is
-- intentionally KEPT here — removing it is Phase D's own later, separately
-- reviewed migration (gated on the new trust mechanism being live and
-- proven), not bundled into this narrow type fix.
--
-- OUT OF SCOPE: no FK from `tenant_id` to `tenants(id)` is added here —
-- worth a fast follow now that the type allows it, but not required for
-- Phase D and kept out to preserve one-change-per-migration discipline.
-- INSERT/UPDATE/DELETE remain default-deny (unchanged from Block 1.11 —
-- still zero live app dependents for any of the three).
--
-- Rollback:
--   DROP POLICY IF EXISTS whatsapp_sessions_tenant_select ON whatsapp_sessions;
--   ALTER TABLE whatsapp_sessions ALTER COLUMN tenant_id TYPE VARCHAR(255) USING tenant_id::varchar;
--   CREATE POLICY whatsapp_sessions_tenant_select ON whatsapp_sessions
--     FOR SELECT
--     USING (
--       tenant_id = auth_tenant_id()::text
--       OR tenant_id = '00000000-0000-0000-0000-000000000001'
--     );

-- 1. Drop the cast-based policy before changing the underlying type.
DROP POLICY IF EXISTS whatsapp_sessions_tenant_select ON whatsapp_sessions;

-- 2. Convert the column. Safe with 0 rows — USING clause is a formality.
ALTER TABLE whatsapp_sessions
  ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid;

-- 3. Re-create the SELECT policy with a plain uuid comparison, matching
--    every other tenant-scoped table's shape.
CREATE POLICY whatsapp_sessions_tenant_select ON whatsapp_sessions
  FOR SELECT
  USING (
    tenant_id = auth_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  );
