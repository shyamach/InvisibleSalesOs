-- phase_1_16_scope_open_rls_tables
--
-- Applied live via the Supabase MCP `apply_migration` tool on 2026-08-18,
-- as part of the full systems audit's Phase A security-fix pass (item A8).
--
-- ai_learning, lead_activities, push_subscriptions, segment_runs each had at
-- least one command with an unconditional qual=true policy for role
-- {public} (= every role including anon) and an INSERT policy that only
-- checked `tenant_id IS NOT NULL` (accepting ANY caller-supplied tenant_id,
-- not verifying it against the caller's own tenant). push_subscriptions'
-- open DELETE additionally let anyone mass-delete any tenant's Web Push
-- credentials. All four had 0 real rows at audit time, so no live data was
-- exposed yet — but this closes the hole before any of these tables carry
-- real content. Replacing with the same tenant_id = auth_tenant_id() OR
-- tenant_id = <default> shape already used across the rest of the schema,
-- for consistency — this is NOT yet the dev-fallback removal (Phase B).
--
-- server.js's /api/responder/dispatch and /api/draft-action handlers were
-- switched from the shared anon-key client to req.supabase + real
-- req.tenantId scoping in this same work session (see git history for
-- server.js around 2026-08-18) so they keep working under these tighter
-- policies instead of silently starting to fail as `anon`.
--
-- NOTE: an UPDATE policy on lead_activities (tenant_activities_update,
-- qual=true) was missed in this migration's first pass — present in the live
-- schema but not caught in the original audit's raw policy dump. Closed
-- separately in phase_1_16b_scope_lead_activities_update_gap.sql.

DROP POLICY IF EXISTS tenant_ai_learning_select ON public.ai_learning;
DROP POLICY IF EXISTS tenant_ai_learning_insert ON public.ai_learning;
DROP POLICY IF EXISTS tenant_ai_learning_update ON public.ai_learning;
CREATE POLICY ai_learning_tenant_select ON public.ai_learning FOR SELECT
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY ai_learning_tenant_insert ON public.ai_learning FOR INSERT
  WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY ai_learning_tenant_update ON public.ai_learning FOR UPDATE
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

DROP POLICY IF EXISTS tenant_activities_select ON public.lead_activities;
DROP POLICY IF EXISTS tenant_activities_insert ON public.lead_activities;
CREATE POLICY lead_activities_tenant_select ON public.lead_activities FOR SELECT
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY lead_activities_tenant_insert ON public.lead_activities FOR INSERT
  WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

DROP POLICY IF EXISTS tenant_push_select ON public.push_subscriptions;
DROP POLICY IF EXISTS tenant_push_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS tenant_push_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_tenant_select ON public.push_subscriptions FOR SELECT
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY push_subscriptions_tenant_insert ON public.push_subscriptions FOR INSERT
  WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY push_subscriptions_tenant_delete ON public.push_subscriptions FOR DELETE
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

DROP POLICY IF EXISTS tenant_segment_runs_select ON public.segment_runs;
DROP POLICY IF EXISTS tenant_segment_runs_insert ON public.segment_runs;
CREATE POLICY segment_runs_tenant_select ON public.segment_runs FOR SELECT
  USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
CREATE POLICY segment_runs_tenant_insert ON public.segment_runs FOR INSERT
  WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
