-- phase_d_3_drop_dev_fallback_or_branch
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Phase D, final step — removes the `OR tenant_id = '0000...0001'` dev-
-- fallback branch from every RLS policy that still carries it, and revokes
-- `anon`'s EXECUTE grant on `auth_tenant_id()` (kept until now only because
-- Postgres must evaluate both sides of that OR for anon callers — see
-- phase_1_12b_harden_auth_tenant_id.sql's own comment on this).
--
-- WHY NOW: Section 24-27 of DB_AUDIT_REPORT.md record the full sequence —
-- (1) a synthetic system-JWT trust mechanism was built so background
-- workers/webhooks no longer need the OR-branch to pass RLS (phase_d_2 +
-- app code), (2) all 7 workers/webhooks were migrated onto it, (3) a live
-- two-tenant isolation test proved the new mechanism itself is sound
-- (no leak, no forgery, either direction) — but ALSO proved the OR-branch
-- itself is a live, currently-exploitable read+write cross-tenant hole: a
-- second tenant's system token could read every row of the dev-fallback
-- tenant's data AND successfully insert a forged row directly into it.
-- That leak has been live since 2026-08-17 (an untouched prior smoke-test
-- fixture tenant, `c9a9319b-4cdc-4958-a2fa-e5f3f232f42e`, already existed),
-- independent of anything in this session — this migration closes it.
--
-- PRE-FLIGHT VERIFICATION performed before drafting this (2026-08-20, live
-- re-check, not assumed from prior sessions' docs):
--   - DEV_BYPASS_AUTH is not set in .env.local or .env.local.example in
--     this environment — the dormant dev-bypass branch in
--     lib/authMiddleware.js (which uses the anon client with no JWT, and
--     would stop working once the OR-branch is gone) is not active. If
--     ever turned on later, it fails CLOSED (empty results), not open —
--     an acceptable direction for that failure mode to move in.
--   - Frontend: all 6 files still constructing a raw Supabase client
--     (frontend/src/lib/supabase.ts, middleware.ts, and the brand-dna,
--     push/subscribe, push/unsubscribe, status, invoices/[id]/pdf API
--     routes) were re-read. Every one either seeds a real user JWT
--     (browser session cookies, or a caller-supplied bearer token
--     verified via supabase.auth.getUser) or proxies to the authenticated
--     Express backend — none depend on the dev-fallback literal.
--   - Backend: grepped controllers/ and lib/ for any remaining module-
--     level `supabase` singleton usage outside req.supabase-scoped
--     request handling. `controllers/tenants.js`/`billing.js` import it
--     but never call it directly (dead import). `lib/supabaseLeads.js`/
--     `supabaseOutreach.js` (insertLead/insertOutreach) use it directly
--     but have zero live callers anywhere in the codebase — pre-existing
--     dead code, unaffected either way.
--   - `engine.js`'s Pass 1 brand_dna fetch and `getTenantIdForBrand()`
--     (the bootstrap lookups the 3 webhook-origin workers use before a
--     tenant is even known) still use the anon client — but `brand_dna`
--     was confirmed to NOT carry the OR-branch pattern at all; it has a
--     separate, unconditionally-open `qual=true` SELECT policy for
--     anon+authenticated. That is a distinct, pre-existing exposure,
--     untouched by this migration either way (flagged separately, not a
--     Phase D deliverable — see the spawned follow-up task on this repo,
--     2026-08-20).
--   - Live `pg_policies` query captured the exact current definition of
--     every policy touched below immediately before drafting this file,
--     so every `ALTER POLICY` statement changes only the OR-fallback
--     clause and leaves every other predicate (e.g. smart_leads SELECT's
--     `AND deleted_at IS NULL`, smart_interactions UPDATE's WITH CHECK)
--     byte-for-byte otherwise identical.
--
-- MECHANISM: `ALTER POLICY ... USING (...)` / `... WITH CHECK (...)` is
-- used instead of DROP + CREATE for every policy — atomic per statement,
-- so a table is never left without its scoped policy mid-migration. Only
-- the clause each policy actually has is altered (INSERT policies only
-- have WITH CHECK; SELECT/DELETE only USING; UPDATE varies — matched
-- exactly to what pg_policies showed live, not assumed).
--
-- Rollback: re-add the literal OR-branch to every altered policy (see the
-- ROLLBACK block at the end of this file) and re-grant EXECUTE on
-- auth_tenant_id() to anon. Re-running this file's own logic in reverse
-- is safe — ALTER POLICY has no history/versioning to lose.

-- ── ai_learning ──────────────────────────────────────────────────────────
ALTER POLICY ai_learning_tenant_insert ON ai_learning
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY ai_learning_tenant_select ON ai_learning
  USING (tenant_id = auth_tenant_id());
ALTER POLICY ai_learning_tenant_update ON ai_learning
  USING (tenant_id = auth_tenant_id());

-- ── call_logs ────────────────────────────────────────────────────────────
ALTER POLICY call_logs_tenant_insert ON call_logs
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY call_logs_tenant_select ON call_logs
  USING (tenant_id = auth_tenant_id());

-- ── closed_deals ─────────────────────────────────────────────────────────
ALTER POLICY closed_deals_tenant_insert ON closed_deals
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY closed_deals_tenant_select ON closed_deals
  USING (tenant_id = auth_tenant_id());

-- ── contacts ─────────────────────────────────────────────────────────────
ALTER POLICY contacts_tenant_delete ON contacts
  USING (tenant_id = auth_tenant_id());
ALTER POLICY contacts_tenant_insert ON contacts
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY contacts_tenant_select ON contacts
  USING (tenant_id = auth_tenant_id());
ALTER POLICY contacts_tenant_update ON contacts
  USING (tenant_id = auth_tenant_id());

-- ── escalations ──────────────────────────────────────────────────────────
ALTER POLICY escalations_tenant_delete ON escalations
  USING (tenant_id = auth_tenant_id());
ALTER POLICY escalations_tenant_insert ON escalations
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY escalations_tenant_select ON escalations
  USING (tenant_id = auth_tenant_id());
ALTER POLICY escalations_tenant_update ON escalations
  USING (tenant_id = auth_tenant_id());

-- ── invoices ─────────────────────────────────────────────────────────────
ALTER POLICY invoices_tenant_delete ON invoices
  USING (tenant_id = auth_tenant_id());
ALTER POLICY invoices_tenant_insert ON invoices
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY invoices_tenant_select ON invoices
  USING (tenant_id = auth_tenant_id());
ALTER POLICY invoices_tenant_update ON invoices
  USING (tenant_id = auth_tenant_id());

-- ── lead_activities ──────────────────────────────────────────────────────
ALTER POLICY lead_activities_tenant_insert ON lead_activities
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY lead_activities_tenant_select ON lead_activities
  USING (tenant_id = auth_tenant_id());
ALTER POLICY lead_activities_tenant_update ON lead_activities
  USING (tenant_id = auth_tenant_id());

-- ── products ─────────────────────────────────────────────────────────────
ALTER POLICY products_tenant_delete ON products
  USING (tenant_id = auth_tenant_id());
ALTER POLICY products_tenant_insert ON products
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY products_tenant_select ON products
  USING (tenant_id = auth_tenant_id());
ALTER POLICY products_tenant_update ON products
  USING (tenant_id = auth_tenant_id());

-- ── push_subscriptions ───────────────────────────────────────────────────
ALTER POLICY push_subscriptions_tenant_delete ON push_subscriptions
  USING (tenant_id = auth_tenant_id());
ALTER POLICY push_subscriptions_tenant_insert ON push_subscriptions
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY push_subscriptions_tenant_select ON push_subscriptions
  USING (tenant_id = auth_tenant_id());

-- ── quotes ───────────────────────────────────────────────────────────────
ALTER POLICY quotes_tenant_insert ON quotes
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY quotes_tenant_select ON quotes
  USING (tenant_id = auth_tenant_id());
ALTER POLICY quotes_tenant_update ON quotes
  USING (tenant_id = auth_tenant_id());

-- ── segment_runs ─────────────────────────────────────────────────────────
ALTER POLICY segment_runs_tenant_insert ON segment_runs
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY segment_runs_tenant_select ON segment_runs
  USING (tenant_id = auth_tenant_id());

-- ── segments ─────────────────────────────────────────────────────────────
ALTER POLICY segments_tenant_insert ON segments
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY segments_tenant_select ON segments
  USING (tenant_id = auth_tenant_id());
ALTER POLICY segments_tenant_update ON segments
  USING (tenant_id = auth_tenant_id());

-- ── smart_interactions ───────────────────────────────────────────────────
ALTER POLICY interactions_tenant_insert ON smart_interactions
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY interactions_tenant_select ON smart_interactions
  USING (tenant_id = auth_tenant_id());
-- This is the one UPDATE policy in the whole set with both USING and an
-- explicit WITH CHECK (added in Block 1.10b — smart_interactions.tenant_id
-- is nullable and its Lane C dependents needed both clauses guarded).
ALTER POLICY smart_interactions_tenant_update ON smart_interactions
  USING (tenant_id = auth_tenant_id())
  WITH CHECK (tenant_id = auth_tenant_id());

-- ── smart_leads ──────────────────────────────────────────────────────────
ALTER POLICY smart_leads_tenant_delete ON smart_leads
  USING (tenant_id = auth_tenant_id());
ALTER POLICY smart_leads_tenant_insert ON smart_leads
  WITH CHECK (tenant_id = auth_tenant_id());
-- SELECT carries an extra soft-delete predicate (Block 1.7b) — preserved
-- exactly, only the OR-fallback clause is removed.
ALTER POLICY smart_leads_tenant_select ON smart_leads
  USING (tenant_id = auth_tenant_id() AND deleted_at IS NULL);
ALTER POLICY smart_leads_tenant_update ON smart_leads
  USING (tenant_id = auth_tenant_id());

-- ── stock_movements ──────────────────────────────────────────────────────
ALTER POLICY stock_movements_tenant_insert ON stock_movements
  WITH CHECK (tenant_id = auth_tenant_id());
ALTER POLICY stock_movements_tenant_select ON stock_movements
  USING (tenant_id = auth_tenant_id());

-- ── tenants (keyed by id, not tenant_id) ─────────────────────────────────
ALTER POLICY tenants_tenant_select ON tenants
  USING (id = auth_tenant_id());
ALTER POLICY tenants_tenant_update ON tenants
  USING (id = auth_tenant_id());

-- ── whatsapp_sessions ────────────────────────────────────────────────────
-- Already plain-uuid comparison (phase_d_1 converted the column from
-- varchar) — no ::text cast needed here, unlike the pre-phase_d_1 shape.
ALTER POLICY whatsapp_sessions_tenant_select ON whatsapp_sessions
  USING (tenant_id = auth_tenant_id());

-- ── Revoke anon's EXECUTE on auth_tenant_id() ───────────────────────────
-- Safe now: nothing left evaluates the OR-branch's left side as anon.
-- authenticated/service_role/postgres keep EXECUTE, unchanged.
REVOKE EXECUTE ON FUNCTION public.auth_tenant_id() FROM anon;

-- ROLLBACK (commented out — for reference only, do not run alongside the
-- ALTER POLICY statements above in the same migration):
--
-- GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO anon;
--
-- ALTER POLICY ai_learning_tenant_insert ON ai_learning WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY ai_learning_tenant_select ON ai_learning USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY ai_learning_tenant_update ON ai_learning USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY call_logs_tenant_insert ON call_logs WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY call_logs_tenant_select ON call_logs USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY closed_deals_tenant_insert ON closed_deals WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY closed_deals_tenant_select ON closed_deals USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY contacts_tenant_delete ON contacts USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY contacts_tenant_insert ON contacts WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY contacts_tenant_select ON contacts USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY contacts_tenant_update ON contacts USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY escalations_tenant_delete ON escalations USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY escalations_tenant_insert ON escalations WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY escalations_tenant_select ON escalations USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY escalations_tenant_update ON escalations USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY invoices_tenant_delete ON invoices USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY invoices_tenant_insert ON invoices WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY invoices_tenant_select ON invoices USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY invoices_tenant_update ON invoices USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY lead_activities_tenant_insert ON lead_activities WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY lead_activities_tenant_select ON lead_activities USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY lead_activities_tenant_update ON lead_activities USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY products_tenant_delete ON products USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY products_tenant_insert ON products WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY products_tenant_select ON products USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY products_tenant_update ON products USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY push_subscriptions_tenant_delete ON push_subscriptions USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY push_subscriptions_tenant_insert ON push_subscriptions WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY push_subscriptions_tenant_select ON push_subscriptions USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY quotes_tenant_insert ON quotes WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY quotes_tenant_select ON quotes USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY quotes_tenant_update ON quotes USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY segment_runs_tenant_insert ON segment_runs WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY segment_runs_tenant_select ON segment_runs USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY segments_tenant_insert ON segments WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY segments_tenant_select ON segments USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY segments_tenant_update ON segments USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY interactions_tenant_insert ON smart_interactions WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY interactions_tenant_select ON smart_interactions USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY smart_interactions_tenant_update ON smart_interactions USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY smart_leads_tenant_delete ON smart_leads USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY smart_leads_tenant_insert ON smart_leads WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY smart_leads_tenant_select ON smart_leads USING ((tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) AND deleted_at IS NULL);
-- ALTER POLICY smart_leads_tenant_update ON smart_leads USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY stock_movements_tenant_insert ON stock_movements WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY stock_movements_tenant_select ON stock_movements USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY tenants_tenant_select ON tenants USING (id = auth_tenant_id() OR id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY tenants_tenant_update ON tenants USING (id = auth_tenant_id() OR id = '00000000-0000-0000-0000-000000000001'::uuid);
-- ALTER POLICY whatsapp_sessions_tenant_select ON whatsapp_sessions USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
