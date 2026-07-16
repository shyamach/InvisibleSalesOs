-- phase_1_7b_drop_smart_leads_permissive_policy
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 1.7b — narrow follow-on to Block 1.4b (email_threads), Block 1.4c
-- (closed_deals), Block 1.5b (invoices), and Block 1.6b (quotes), same
-- shape, next table cleared by the Block 1.7 blocker resolution: Block 1.7a
-- (ab6b86f) added explicit `.eq('tenant_id', ...)` filters to db.js's phone
-- lookup, controllers/calls.js's lead select, controllers/leadWebhook.js's
-- linkLeadContact update, server.js's WhatsApp smart_leads updates, and four
-- frontend pages (leads/page.tsx, leads/[id]/page.tsx, drafts/page.tsx,
-- quotes/new/page.tsx); Block 1.7a-2 (5e5c3e3) closed the two remaining
-- high-traffic gaps in lib/autoReplySweeper.js (candidate SELECT, claim
-- UPDATE, mark-sent UPDATE, release-claim UPDATE) and engine.js's
-- post-auto-reply-decision UPDATE. The final post-1.7a/1.7a-2 read-only
-- audit re-confirmed all of the above directly against current source and
-- found only two remaining unscoped `smart_leads` references, neither an
-- operational blocker:
--   - server.js's `/api/responder/dispatch` smart_interactions→smart_leads
--     embed: read-only, gated by requireInternalKey, not end-user reachable.
--   - lib/supabaseLeads.js's `insertLead()`: dead code, zero callers
--     anywhere in the repo (confirmed by repo-wide grep).
--
-- `smart_leads` carries 4 legacy permissive policies (SELECT:
-- `deleted_at IS NULL`, no tenant check at all; INSERT: `tenant_id IS NOT
-- NULL`; UPDATE/DELETE: `qual = true`, fully open) alongside 4
-- already-scoped sibling policies (`smart_leads_tenant_select/_insert/
-- _update/_delete`, all using `tenant_id = auth_tenant_id() OR tenant_id =
-- <dev-fallback-tenant>`). Confirmed live via `pg_policies` on 2026-07-16:
--
--   Legacy (dropped by this migration):
--     tenant_leads_select  SELECT  USING (deleted_at IS NULL)
--     tenant_leads_insert  INSERT  WITH CHECK (tenant_id IS NOT NULL)
--     tenant_leads_update  UPDATE  USING (true)
--     tenant_leads_delete  DELETE  USING (true)
--
--   Scoped (kept; smart_leads_tenant_select replaced with soft-delete
--   parity, the other three left unchanged):
--     smart_leads_tenant_select  SELECT  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001')
--     smart_leads_tenant_insert  INSERT  WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001')
--     smart_leads_tenant_update  UPDATE  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001')
--     smart_leads_tenant_delete  DELETE  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001')
--
-- Unlike quotes (which has no scoped DELETE sibling by design), `smart_leads`
-- retains full CRUD coverage under the scoped policies alone once the 4
-- legacy policies are dropped — this is a strict risk reduction with no
-- coverage gap on any command: SELECT/INSERT/UPDATE/DELETE are each still
-- served by exactly one scoped policy after this migration.
--
-- SOFT-DELETE PARITY (why smart_leads_tenant_select is replaced, not left
-- as-is): `tenant_leads_select` is the only policy anywhere that enforces
-- `deleted_at IS NULL` for smart_leads reads — the existing
-- `smart_leads_tenant_select` does not carry that clause. A repo-wide audit
-- (2026-07-16) found:
--   - 0 of 13 live smart_leads rows are currently soft-deleted, and
--   - no code path anywhere in this codebase ever writes `deleted_at` on
--     smart_leads (the only `.update({ deleted_at: ... })` call in the
--     entire repo targets the unrelated `products` table) — so there is no
--     live soft-delete feature this drop could regress today.
-- Even so, dropping `tenant_leads_select` outright would silently remove
-- the only enforcement of that invariant at the RLS layer, leaving it to
-- rely on the accident that no soft-delete feature exists yet. Rather than
-- accept that dormant gap, this migration folds `deleted_at IS NULL` into
-- `smart_leads_tenant_select` itself (DROP + CREATE, since Postgres has no
-- ALTER POLICY ... USING), so the behaviour is preserved permanently at the
-- policy layer regardless of whether a soft-delete feature is added later
-- without anyone remembering to update this policy at that time.
--
-- ⚠️ IMPORTANT — THIS DOES NOT SOLVE FINAL PRODUCTION TENANT ISOLATION:
-- the scoped policies (both the three left unchanged and the replacement
-- SELECT policy below) still use `tenant_id = auth_tenant_id() OR
-- tenant_id = '00000000-0000-0000-0000-000000000001'` — the `OR
-- <dev-fallback-tenant>` branch is a pre-auth-mapping scaffold (see
-- DB_AUDIT_REPORT.md §3 item 1 and the Block 1.4a audit), not the desired
-- production model. Under an anon client with no JWT, `auth_tenant_id()`
-- always evaluates to NULL, so every app code path and every access this
-- migration keeps working continues to work only via that literal-UUID
-- fallback branch, not real per-tenant `auth.uid()`-based isolation. That
-- remains open work (Block 1's `auth.uid() → tenant_id` mapping, still not
-- implemented anywhere in this codebase) — this migration only removes the
-- any-tenant-can-touch-any-other-tenant's-leads hole, it does not add real
-- multi-tenant auth.
--
-- Rollback: re-run the commented-out CREATE POLICY statements below, which
-- reproduce the exact pre-migration definitions confirmed live on
-- 2026-07-16 — including the ORIGINAL smart_leads_tenant_select (without
-- the deleted_at clause), so a rollback restores all five touched policies
-- to their exact prior state, not just the four legacy ones.
--
-- ROLLBACK (commented out — for reference only, do not run alongside the
-- DROP/CREATE statements below in the same migration):
--
-- CREATE POLICY tenant_leads_select ON smart_leads
--   FOR SELECT
--   USING (deleted_at IS NULL);
--
-- CREATE POLICY tenant_leads_insert ON smart_leads
--   FOR INSERT
--   WITH CHECK (tenant_id IS NOT NULL);
--
-- CREATE POLICY tenant_leads_update ON smart_leads
--   FOR UPDATE
--   USING (true);
--
-- CREATE POLICY tenant_leads_delete ON smart_leads
--   FOR DELETE
--   USING (true);
--
-- DROP POLICY IF EXISTS smart_leads_tenant_select ON smart_leads;
-- CREATE POLICY smart_leads_tenant_select ON smart_leads
--   FOR SELECT
--   USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- 1. Replace smart_leads_tenant_select with a version carrying soft-delete
--    parity (see rationale above). Postgres has no ALTER POLICY ... USING,
--    so this is DROP + CREATE, not ALTER.
DROP POLICY IF EXISTS smart_leads_tenant_select ON smart_leads;

CREATE POLICY smart_leads_tenant_select ON smart_leads
  FOR SELECT
  USING (
    (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
    AND deleted_at IS NULL
  );

-- 2. smart_leads_tenant_insert / smart_leads_tenant_update /
--    smart_leads_tenant_delete are left unchanged — no action needed.

-- 3. Drop the four legacy permissive policies.
DROP POLICY IF EXISTS tenant_leads_select ON smart_leads;
DROP POLICY IF EXISTS tenant_leads_insert ON smart_leads;
DROP POLICY IF EXISTS tenant_leads_update ON smart_leads;
DROP POLICY IF EXISTS tenant_leads_delete ON smart_leads;
