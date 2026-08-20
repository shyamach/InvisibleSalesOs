-- phase_1_18_call_logs_select_policy
--
-- Applied live via the Supabase MCP `apply_migration` tool on 2026-08-18,
-- Phase B item B2 of the master development plan from the same day's audit.
--
-- call_logs had an INSERT policy (call_logs_tenant_insert) but no SELECT
-- policy at all, confirmed both in the live pg_policies dump and
-- independently documented in tests/callLogs.migration.test.js's own header
-- comment ("call_logs had ZERO scoped sibling policies before this
-- migration... SELECT and UPDATE get no scoped replacement by design").
-- Since Postgres RLS also governs RETURNING clauses on INSERT, this meant
-- controllers/calls.js's `.insert({...}).select('id').single()` has likely
-- been silently returning null for `callLog.id` all along, and any future
-- SELECT against call_logs (e.g. a call-history view) would return zero
-- rows even for a legitimately authenticated tenant member. Adding a
-- SELECT policy in the same tenant-scoped shape used everywhere else.

CREATE POLICY call_logs_tenant_select ON public.call_logs FOR SELECT
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
