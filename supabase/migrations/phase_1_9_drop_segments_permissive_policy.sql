-- phase_1_9_drop_segments_permissive_policy
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 1.9 — narrow follow-on to Block 1.4b (email_threads), Block 1.4c
-- (closed_deals), Block 1.5b (invoices), Block 1.6b (quotes), Block 1.7b
-- (smart_leads), and Block 1.8 (call_logs); next table cleared by the
-- Block 1.9 planning audit (2026-07-17). Full repo-wide access-path audit
-- found `segments` has:
--   - 0 live rows (empty table),
--   - `tenant_id` NOT NULL at the schema level,
--   - no `deleted_at` column (no soft-delete concept for this table),
--   - zero backend controller access — every dependent is a raw frontend
--     anon Supabase client (no JWT), unlike call_logs (one backend path)
--     or any table with a server-side controller.
--
-- `segments` carries 4 legacy permissive policies and, like call_logs
-- (Block 1.8), **zero scoped sibling policies of any kind** to fall back
-- on. Unlike call_logs, this is a harder case: call_logs had exactly one
-- command (INSERT) with a real app dependent, so only one scoped policy
-- had to be added before dropping legacy ones. `segments` has THREE
-- commands — SELECT, INSERT, and UPDATE — with live, end-user-reachable
-- frontend dependents:
--
--   1. SELECT — frontend/src/app/app/segments/page.tsx's list view
--      (anon client, filtered client-side by a hardcoded TENANT_ID).
--   2. SELECT (Realtime) — the same page's `segments-watch` Realtime
--      channel (`postgres_changes` on the `segments` table), which is
--      also gated by the SELECT policy — Realtime does not bypass RLS.
--   3. INSERT — frontend/src/app/app/segments/new/page.tsx's "Save
--      Segment" form (anon client, stamps `tenant_id: TENANT_ID`
--      correctly).
--   4. UPDATE — frontend/src/app/app/segments/page.tsx's "Run Campaign"
--      button, which sets `last_run_at` on the clicked segment. This call
--      filters ONLY by `.eq("id", segment.id)` — it does NOT filter by
--      tenant_id in the app-level query. That means, after this migration,
--      the new scoped UPDATE policy's `USING` clause is the *sole* tenant
--      boundary on this call path — there is no app-level WHERE clause
--      backing it up. Getting this policy's condition right matters more
--      here than on any prior table in this family.
--
-- DELETE has zero app dependents anywhere (confirmed by repo-wide grep,
-- including `tests/`) — no delete button, route, or backend code touches
-- `segments`. Consistent with `quotes`' DELETE (Block 1.6b) and
-- `closed_deals`' UPDATE/DELETE (Block 1.4c), this migration drops the
-- legacy DELETE policy with no scoped replacement, by design — DELETE
-- becomes fully default-deny.
--
-- Confirmed live via `pg_policies` on 2026-07-17:
--
--   Legacy (dropped by this migration):
--     tenant_segments_select  SELECT  USING (true)
--     tenant_segments_insert  INSERT  WITH CHECK (tenant_id IS NOT NULL)
--     tenant_segments_update  UPDATE  USING (true)
--     tenant_segments_delete  DELETE  USING (true)
--
-- Because no scoped policy exists yet for any command, this migration adds
-- three new scoped policies (SELECT, INSERT, UPDATE) before/while dropping
-- their legacy counterparts, the same "add before drop" shape as call_logs'
-- Block 1.8 migration, just for three commands instead of one.
--
-- ⚠️ IMPORTANT — THIS DOES NOT SOLVE FINAL PRODUCTION TENANT ISOLATION:
-- all three new scoped policies use `tenant_id = auth_tenant_id() OR
-- tenant_id = '00000000-0000-0000-0000-000000000001'` — the `OR
-- <dev-fallback-tenant>` branch is a pre-auth-mapping scaffold (see
-- DB_AUDIT_REPORT.md §3 item 1 and the Block 1.4a audit), not the desired
-- production model. Under an anon client with no JWT, `auth_tenant_id()`
-- always evaluates to NULL, so every one of `segments`' real dependents
-- (list view, Realtime subscription, create form, Run Campaign) keeps
-- working only via that literal-UUID fallback branch, not real per-tenant
-- `auth.uid()`-based isolation. That remains open work (Block 1's
-- `auth.uid() → tenant_id` mapping, still not implemented anywhere in this
-- codebase) — this migration only removes the any-tenant-can-read/write/
-- delete hole, it does not add real multi-tenant auth.
--
-- OUT OF SCOPE — `segment_runs`: the adjacent table written by the same
-- "Run Campaign" flow (`segment_runs` INSERT from
-- frontend/src/app/app/segments/page.tsx) carries an identical
-- zero-scoped-policy pattern (`tenant_segment_runs_select` USING true,
-- `tenant_segment_runs_insert` WITH CHECK tenant_id IS NOT NULL, no
-- UPDATE/DELETE policy). It is NOT one of the 3 SHOWSTOPPER tables this
-- migration addresses and this migration does not touch it — noted here
-- only as a known dependency of the same UI flow, left for its own future
-- block.
--
-- Rollback: re-run the commented-out statements below, which reproduce the
-- exact pre-migration definitions confirmed live on 2026-07-17.
--
-- ROLLBACK (commented out — for reference only, do not run alongside the
-- CREATE/DROP statements below in the same migration):
--
-- DROP POLICY IF EXISTS segments_tenant_select ON segments;
-- DROP POLICY IF EXISTS segments_tenant_insert ON segments;
-- DROP POLICY IF EXISTS segments_tenant_update ON segments;
--
-- CREATE POLICY tenant_segments_select ON segments
--   FOR SELECT
--   USING (true);
--
-- CREATE POLICY tenant_segments_insert ON segments
--   FOR INSERT
--   WITH CHECK (tenant_id IS NOT NULL);
--
-- CREATE POLICY tenant_segments_update ON segments
--   FOR UPDATE
--   USING (true);
--
-- CREATE POLICY tenant_segments_delete ON segments
--   FOR DELETE
--   USING (true);

-- 1. Add the three scoped policies current app behaviour actually needs —
--    SELECT, INSERT, UPDATE — before dropping the legacy policies they
--    replace.
CREATE POLICY segments_tenant_select ON segments
  FOR SELECT
  USING (
    tenant_id = auth_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

CREATE POLICY segments_tenant_insert ON segments
  FOR INSERT
  WITH CHECK (
    tenant_id = auth_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

CREATE POLICY segments_tenant_update ON segments
  FOR UPDATE
  USING (
    tenant_id = auth_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  );

-- 2. Drop the four legacy permissive policies. DELETE gets no scoped
--    replacement (no app dependent — see rationale above), so it becomes
--    fully default-deny.
DROP POLICY IF EXISTS tenant_segments_select ON segments;
DROP POLICY IF EXISTS tenant_segments_insert ON segments;
DROP POLICY IF EXISTS tenant_segments_update ON segments;
DROP POLICY IF EXISTS tenant_segments_delete ON segments;
