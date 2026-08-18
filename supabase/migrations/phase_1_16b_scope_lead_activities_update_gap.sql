-- phase_1_16b_scope_lead_activities_update_gap
--
-- Applied live via the Supabase MCP `apply_migration` tool on 2026-08-18,
-- immediately after phase_1_16, as a follow-up fix caught during
-- post-migration verification.
--
-- phase_1_16 fixed lead_activities' SELECT and INSERT policies but missed an
-- UPDATE policy (tenant_activities_update, qual=true for {public}) that was
-- present in the live schema but not caught in the original audit's raw
-- policy dump (a large, easy-to-miss JSON blob) nor in the migration written
-- from it. Closing it now with the same tenant-scoped shape as everything
-- else.

DROP POLICY IF EXISTS tenant_activities_update ON public.lead_activities;
CREATE POLICY lead_activities_tenant_update ON public.lead_activities FOR UPDATE
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
