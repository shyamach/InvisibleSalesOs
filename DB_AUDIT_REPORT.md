# DB Audit Report — Invisible Sales OS
**Date:** 2026-06-27
**Auditor:** Database Lead (Claude Sonnet 4.6)
**Supabase Project:** lmslyfxvvnvjojsymehy
**Scope:** Full schema audit + migration run

---

## 1. What We Found (Pre-Migration State)

### Tables Inventoried
14 tables in the `public` schema:

| Table | RLS Enabled | Row Count | UUID PK |
|---|---|---|---|
| tenants | YES | 1 | YES |
| smart_leads | YES | 3 | YES |
| smart_interactions | YES | 12 | YES |
| brand_dna | YES | 0 | NO (int4 serial) |
| company_knowledge | YES | 0 | NO (int4 serial) |
| quotes | YES | 0 | YES |
| invoices | YES | 0 | YES |
| lead_activities | YES | 9 | YES |
| ai_learning | YES | 0 | YES |
| call_logs | YES | 0 | YES |
| email_threads | YES | 0 | YES |
| segments | YES | 0 | YES |
| segment_runs | YES | 0 | YES |
| push_subscriptions | YES | 0 | YES |
| inventory | YES | 0 | YES |
| whatsapp_sessions | YES | 0 | NO (int4 serial) |
| closed_deals | YES | 0 | NO (int4 serial) |
| interactions | YES | 0 | YES (legacy shadow table) |

---

### Index State (Pre-Migration)

**What existed:** Single-column indexes only on tenant_id, lead_id, created_at, direction for most tables. Pipeline-stage and triage_status were indexed solo on smart_leads but not compositely with tenant_id.

**Critical gap:** Every multi-tenant dashboard query (e.g., "show me all pending leads for tenant X sorted by date") had to scan the entire tenant_id index then re-filter on triage_status or pipeline_stage separately. At 10k rows this is a sequential scan masquerading as an index scan.

**Invoices:** Had `idx_invoices_direction (tenant_id, direction)` and `idx_invoices_status (tenant_id, status)` but no three-column composite covering direction + status together — the most common invoice reporting query pattern.

**lead_activities:** Had separate indexes on lead_id and created_at — no composite, meaning timeline queries for a specific lead required a merge join of two separate index scans.

**ai_learning:** tenant_id indexed solo; action indexed solo; no composite — expensive for the feedback loop queries that filter by both.

**Missing entirely:**
- No index on `smart_leads(tenant_id, lead_channel_id)` — channel deduplication queries would table scan
- No composite on `smart_leads(tenant_id, triage_status, created_at)` — the lead inbox query runs this pattern on every page load

---

### RLS Policy State (Pre-Migration)

This was the most concerning finding. Every table was using catch-all permissive policies:

```
anon_all_smart_leads       — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_smart_interactions — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_lead_activities   — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_ai_learning       — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_call_logs         — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_quotes            — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_email_threads     — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_segments          — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_segment_runs      — ALL commands, roles: {anon,authenticated}, qual: true
anon_all_push_subscriptions — ALL commands, roles: {anon,authenticated}, qual: true
tenant_invoices_all        — ALL commands, roles: {public}, qual: true
```

**Two additional problems on smart_leads:**
1. Two overlapping policies existed simultaneously: `anon_all_smart_leads` (anon+authenticated, ALL) and `Allow backend to insert leads` (public, INSERT) — duplicate coverage, contradiction risk when auth is added
2. Neither policy checked tenant_id — any anon caller could read or write any tenant's lead data

**tenants table:** Only SELECT policy, no INSERT/UPDATE/DELETE — fine for now but will need write policies when self-serve signup is wired

**closed_deals:** No tenant_id column at all — see Section 4

---

### tenant_metrics View (Pre-Migration)

View existed but was not soft-delete aware. Counts for `total_leads` and `leads_won` included records that would be soft-deleted post-migration. Also missing invoice-based financial metrics (total_invoice_value, paid_invoice_value).

---

### tenants Table (Pre-Migration)

Missing columns needed for SaaS operations:
- `owner_email` — no way to associate a tenant with a billing contact
- `subscription_tier` — plan enforcement impossible without this; existing `plan` column has a CHECK constraint locking it to `{starter, growth, enterprise}` but no `trial` tier
- `trial_started_at` — can't calculate trial expiry without this
- `settings` — no tenant-level config blob for feature flags, webhook URLs, etc.

**Note:** The existing `plan` column with CHECK `{starter, growth, enterprise}` conflicts with the new `subscription_tier` column (DEFAULT 'trial'). Both now co-exist. See Section 4.

---

## 2. What Was Fixed (Migrations Applied)

### Migration 1: `add_composite_indexes`
Applied 7 new composite indexes:

```sql
idx_leads_tenant_stage         — smart_leads(tenant_id, pipeline_stage)
idx_leads_tenant_status_date   — smart_leads(tenant_id, triage_status, created_at DESC)
idx_interactions_lead_dir      — smart_interactions(lead_id, direction)
idx_ai_learning_tenant_action  — ai_learning(tenant_id, action)
idx_invoices_tenant_dir_status — invoices(tenant_id, direction, status)
idx_activities_lead_date       — lead_activities(lead_id, created_at DESC)
idx_leads_channel_id           — smart_leads(tenant_id, lead_channel_id)
```

These directly accelerate the six most expensive query patterns:
- Lead inbox (tenant + triage_status + date)
- Pipeline board (tenant + pipeline_stage)
- Interaction timeline (lead + direction filter)
- AI feedback loop reporting (tenant + action)
- Invoice reporting (tenant + direction + status in one scan)
- Activity feed per lead (lead + date)

### Migration 2: `add_soft_delete_columns`

```sql
ALTER TABLE smart_leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE invoices   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
```

Soft delete is now structurally possible. The `tenant_leads_select` and `tenant_invoices_select` RLS policies enforce `deleted_at IS NULL` on reads — deleted records are invisible to all queries without any application-layer filtering required.

### Migration 3: `add_tenant_metadata_columns`

Added to tenants:
- `owner_email TEXT` — nullable, no constraint (will be populated on signup flow)
- `subscription_tier TEXT DEFAULT 'trial'` — separate from the `plan` column
- `trial_started_at TIMESTAMPTZ DEFAULT now()` — auto-set on new tenants
- `settings JSONB DEFAULT '{}'` — tenant config blob

### Migration 4: `harden_rls_policies`

Replaced all catch-all single-policy patterns with per-command structured policies across 11 tables:

| Table | Old Policy | New Policies |
|---|---|---|
| smart_leads | 1x ALL (anon+authenticated, true) + 1x INSERT (public, true) | SELECT (deleted_at IS NULL), INSERT (tenant_id NOT NULL), UPDATE (true), DELETE (true) |
| invoices | 1x ALL (public, true) | SELECT (deleted_at IS NULL), INSERT (tenant_id NOT NULL), UPDATE (true), DELETE (true) |
| smart_interactions | 1x ALL (anon+authenticated, true) | SELECT, INSERT (tenant_id NOT NULL), UPDATE, DELETE |
| lead_activities | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE |
| ai_learning | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE |
| quotes | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE, DELETE |
| call_logs | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE |
| segments | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE, DELETE |
| segment_runs | 1x ALL | SELECT, INSERT (tenant_id NOT NULL) |
| push_subscriptions | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), DELETE |
| email_threads | 1x ALL | SELECT, INSERT (tenant_id NOT NULL), UPDATE |
| closed_deals | 1x ALL | SELECT, INSERT (true), UPDATE |
| whatsapp_sessions | 2x overlapping | Removed catch-all; retained "Allow backend to manage sessions" (public, ALL) |

All policies currently use `true` quals where tenant enforcement isn't yet possible (no auth.uid() → tenant mapping). This is intentional scaffolding — the structure is correct for tight enforcement once Supabase Auth is wired.

### Migration 5: `rebuild_tenant_metrics_view`

Dropped and rebuilt `tenant_metrics` as a merged superset combining the best of the old definition and the new spec:

**Old columns preserved:** leads_this_week, revenue_attributed, drafts_approved, drafts_dismissed, replies_received, calls_logged, quotes_sent, pipeline_value

**New columns added:** high_priority_leads, leads_won (soft-delete aware), total_invoice_value, paid_invoice_value

**Soft-delete awareness added to:** total_leads, high_priority_leads, leads_won, total_invoice_value, paid_invoice_value, revenue_attributed

View tested — returns live data for dev tenant correctly.

### Migration 6: `phase1_contacts_and_auto_reply` (2026-06-28)

Phase 1 foundation — contact entity model + auto-reply with approval window.

**New table `contacts`** — one person, multiple channel endpoints. Columns: `tenant_id` (NOT NULL, FK → tenants, CASCADE), `name`, `company_name`, `preferred_channel` (CHECK: whatsapp/email/sms/instagram/messenger/manual, default whatsapp), `channels` JSONB (endpoint map, e.g. `{"whatsapp":"+447…","email":"a@b.com"}`), `notes`, `created_at`, `updated_at`, `deleted_at` (soft delete). Indexes: partial `idx_contacts_tenant` (WHERE deleted_at IS NULL), GIN `idx_contacts_channels_gin`. RLS enabled with 4 structured policies (`contacts_tenant_{select,insert,update,delete}`) using the standard `auth_tenant_id() OR dev-tenant` pattern. Added `set_updated_at()` trigger function + `trg_contacts_updated_at`.

**`smart_leads` additions:** `contact_id` (FK → contacts, ON DELETE SET NULL), `auto_reply_decision` (CHECK: auto_dispatch/scheduled/manual), `auto_reply_status` (NOT NULL default `none`; CHECK: none/scheduled/dispatched/rejected/manual_review/sent), `scheduled_dispatch_at`. Indexes: `idx_smart_leads_contact`; partial `idx_smart_leads_scheduled` (WHERE auto_reply_status='scheduled') for a future sweeper.

**`tenants` addition:** `auto_reply` JSONB (NOT NULL, default `{"enabled":false,"priority_rules":{"HIGH":"manual","MEDIUM":"window","LOW":"auto"},"window_minutes":30}`). Master toggle + per-priority routing config.

Backfill verified: existing tenant row picked up the default; new lead columns present; 4 contact policies active.

### Migration 7: `phase1_catalogue_products_stock` (2026-06-28)

**New table `products`** — canonical catalogue (supersedes legacy `inventory`, which is left intact). Columns: `tenant_id` (FK, CASCADE), `sku`, `name` (NOT NULL), `description`, `category`, `price` (numeric, default 0), `currency` (default GBP), `stock_quantity` (int, default 0), `unit` (default 'unit'), `status` (CHECK active/archived/out_of_stock), `created_at`, `updated_at`, `deleted_at` (soft delete). Indexes: unique `(tenant_id, lower(sku)) WHERE deleted_at IS NULL AND sku IS NOT NULL`, partial tenant index, `lower(name)` for ilike matching. RLS: 4 standard `products_tenant_*` policies. `trg_products_updated_at` trigger (reuses set_updated_at()).

### Migration 8: `phase1_rebuild_stock_movements_for_products` (2026-06-28)

Discovered a pre-existing **empty, code-unreferenced** `stock_movements` table whose `product_id` FK pointed at the LEGACY `inventory` table (schema: movement_type/quantity/stock_after/reference_*). Since Phase 1 replaces inventory with `products`, dropped that orphan and rebuilt `stock_movements` as an **append-only ledger** bound to `products`: `tenant_id` (FK), `product_id` (FK → products, CASCADE), `delta` (signed int), `balance_after` (int), `reason` (CHECK manual_adjustment/sale/restock/correction/import/return), `note`, `created_by`, `created_at`. Indexes on (product_id, created_at DESC) + tenant. RLS: SELECT + INSERT only (no UPDATE/DELETE — ledger is immutable). Safe: 0 rows dropped, no code referenced it.

### Migration 9: `phase1_escalations_and_outcome_tracking` (2026-06-28)

**New table `escalations`** — sales-rep handoff queue + outcome tracking. Columns: `tenant_id` (FK), `lead_id` (FK → smart_leads, CASCADE), `reason` (CHECK out_of_stock/price_negotiation/manual/other), `status` (CHECK pending/accepted/converted/rejected/stalled, default pending), `assigned_to` (uuid → auth.users, SET NULL — for when employee accounts exist), `assigned_to_name` (free-text rep label until then), `trigger_context`, `note`, `outcome_note`, `deal_value`, `created_at`, `resolved_at`, `updated_at`. Indexes: (tenant_id, status), lead, assignee. RLS: 4 standard policies. `trg_escalations_updated_at` trigger.

**`smart_leads` additions:** `escalation_status` (NOT NULL default 'none'; CHECK none/pending/resolved) + `escalated_at` — denormalised flag for fast filtering in the leads UI.

### Migration 10: `phase1_retire_legacy_inventory` (2026-06-28)

Dropped the legacy `inventory` table (superseded by `products`). Was empty (0 rows); the only FK that referenced it (old stock_movements) was already removed in Migration 8; `db.js checkLiveInventory` repointed to `products`.

### Migration 11: `phase1_team_members_and_activity_actor` (2026-06-28)

Employee accounts + attribution groundwork. Added `lead_activities.actor_user_id` (FK → auth.users, SET NULL) + index for forward-looking per-user attribution. Added two SECURITY DEFINER helpers (no service-role key available): `get_tenant_members(p_tenant_id)` (joins user_tenants + auth.users to return members WITH emails) and `get_user_id_by_email(p_email)` (resolve an existing user to link). Both GRANTed to anon/authenticated. **Security note:** these are currently only gated by the server-side INTERNAL_API_KEY; tighten to caller-scoped once real per-user auth context flows through (added to security backlog).

---

## 3. What Still Needs Attention

### CRITICAL

**1. No auth.uid() → tenant_id mapping exists.**
All RLS policies currently use `true` as the USING clause — they are structurally correct but not actually enforcing tenant isolation at the row level. Until you add a `user_tenants` join table (or store tenant_id in JWT claims via a custom Supabase auth hook), any authenticated user can read any tenant's data. This is the single most urgent security gap.

Fix pattern:
```sql
-- Example: tighten smart_leads SELECT when auth is ready
DROP POLICY "tenant_leads_select" ON smart_leads;
CREATE POLICY "tenant_leads_select" ON smart_leads
  FOR SELECT USING (
    deleted_at IS NULL AND
    tenant_id = (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid())
  );
```

**2. `closed_deals` has no `tenant_id` column.**
This table was created early (int4 serial PK, no FK to tenants) and was never migrated into the multi-tenant model. Any data written here is cross-tenant by default. Either:
- Add `tenant_id UUID REFERENCES tenants(id)` and backfill
- Or migrate closed deal tracking into `invoices` with `status = 'paid'` (preferred — eliminates the duplicate concept)

**3. `interactions` table is a zombie.**
There is a bare `interactions` table (uuid PK, lead_id, message_content, direction, timestamp) with RLS enabled but no policies. It appears to be a pre-migration shadow of `smart_interactions`. It is not referenced by any foreign key and has 0 rows. It should be dropped after confirming no backend code references it.

Check: `grep -r "from interactions" /Users/shyamachand/Documents/invisible-sales-os/`

### HIGH

**4. `brand_dna` and `company_knowledge` use int4 serial PKs.**
All other core tables use UUID PKs. The int4 serial on brand_dna means a tenant could infer how many brand configs exist globally by watching their own IDs increment. Not a data leak today, but it leaks operational metadata and creates a FK type mismatch risk if you ever join brand_dna.id against a UUID column.

**5. `whatsapp_sessions.tenant_id` is VARCHAR, not UUID.**
Every other table uses UUID for tenant_id. This varchar column will cause silent failures if someone passes a well-formed UUID string with extra whitespace or case variation, and breaks any future JOIN between whatsapp_sessions and other tenant-scoped tables.

Fix:
```sql
ALTER TABLE whatsapp_sessions
  ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid;
```
(Requires that all existing values are valid UUID strings — confirm first.)

**6. `tenants` has duplicate plan concepts.**
The existing `plan` column (CHECK: starter/growth/enterprise, NOT NULL) and the new `subscription_tier` (DEFAULT 'trial') are now both present. The application needs to decide which is canonical. Recommendation: deprecate `plan`, migrate its CHECK constraint values into `subscription_tier`, and drop `plan` in the next cleanup migration.

**7. Soft delete not applied to `quotes` or `lead_activities`.**
These tables have no `deleted_at` column. If a user deletes a quote or an activity, it is hard-deleted permanently. Consider adding soft delete to quotes especially — financial audit trails should not have gaps.

**8. No `updated_at` trigger on tables that have the column.**
`smart_leads`, `smart_interactions`, `invoices`, and `quotes` all have `updated_at TIMESTAMPTZ` columns but no trigger to auto-update them on row modification. They will silently stay at their creation timestamp unless the application manually sets them on every UPDATE.

Fix (repeat for each table):
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER smart_leads_updated_at
  BEFORE UPDATE ON smart_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### MEDIUM

**9. `company_knowledge` embedding index may be premature.**
An IVFFlat index with `lists=100` is defined on a table with 0 rows. IVFFlat requires at least `lists * 39` rows (≈3,900) to be effective — below that it degrades to a full scan anyway. This index is not harmful but wastes a small amount of write overhead on empty data. Rebuild it with `lists=10` when you have real data, bump to 100+ at 10k+ rows.

**10. `segments.lead_count` is a denormalized integer column.**
This counter is not auto-maintained — it requires the application to manually update it after each segment run. It will drift out of sync if segment_runs fail partway through or if leads are soft-deleted. Either remove it and compute on demand from segment_runs, or add a trigger on segment_runs INSERT to update it.

**11. No index on `email_threads(tenant_id, status)`.**
The email inbox view will filter by both. Currently only `idx_email_threads_tenant_id` (solo) exists. Add:
```sql
CREATE INDEX idx_email_threads_tenant_status ON email_threads(tenant_id, status);
```

**12. `push_subscriptions` stores raw auth key as plaintext.**
The `auth` column stores the push subscription auth secret unencrypted. This is standard for Web Push (the secret is client-generated and not considered sensitive in the same way as a password), but document this decision and ensure storage bucket ACLs are not publicly readable.

---

## 4. Performance Observations (10k Rows+)

### smart_leads — Will struggle without composite indexes
Before this migration, a query like `SELECT * FROM smart_leads WHERE tenant_id = $1 AND triage_status = 'pending' ORDER BY created_at DESC` would hit two separate indexes or fall back to a seq scan. Now `idx_leads_tenant_status_date` covers this exact pattern in one B-tree scan. At 10k leads this is the difference between ~2ms and ~50ms per page load.

### smart_interactions — The hidden hotspot
With 12 rows now and potentially 100+ interactions per lead at scale, this table will grow fastest of all. The new `idx_interactions_lead_dir` composite is critical — without it, every conversation view does a full scan of the lead's interaction history just to filter by direction. At 100k rows this becomes the top slow-query candidate.

### tenant_metrics view — Will not scale past ~50 tenants in current form
The view uses unconstrained LEFT JOINs across 6 tables with no WHERE clause. As data grows, this becomes a full cross-join aggregate. It is fine for a dashboard that queries a single tenant at a time, but if you ever query all tenants simultaneously (e.g., an admin panel), this view will be extremely slow.

Fix: Add a materialized view with a background refresh, or add `WHERE t.id = $1` to the view query and use a parameterized function instead.

### invoices — OK for now, watch total_amount aggregations
The `idx_invoices_tenant_dir_status` composite will accelerate the most common reporting queries. The `total_amount` column is manually maintained (not computed), which means aggregation queries are fast but data integrity depends on the application always setting it correctly. Consider adding a computed/generated column for tax_amount validation.

### ai_learning — Append-only, no housekeeping defined
This table grows every time a draft is approved, edited, or dismissed. There is no archival or TTL policy. At 1 message/lead/day with 1,000 active leads, this is 365k rows/year. Define a retention policy before you hit Supabase's free tier row limits.

---

## 5. Security Observations

### Showstopper: RLS is structurally present but logically open
All RLS is enabled on all tables (verified). All per-command policies exist (verified post-migration). But without `auth.uid()` → `tenant_id` resolution in the policy USING clauses, the policies are equivalent to `GRANT ALL ON ALL TABLES TO public`. The structure is scaffolded correctly — locking it down requires only one auth hook and a `user_tenants` table. This must happen before any external user touches the system.

### anon role still has broad access
Several tables (brand_dna, company_knowledge, inventory, tenants) still use `{anon, authenticated}` role policies. The anon role should not be able to read brand voice guidelines, product catalog data, or tenant metadata without any authentication. These policies predate the multi-tenancy work and were not changed in this migration pass (they are SELECT-only, which reduces risk, but they are still open).

Recommendation: flip `anon_read_brand_dna`, `anon_read_company_knowledge`, `anon_read_inventory` to `authenticated` role only once Supabase Auth is active.

### tenants table has no write policies
There is only one policy on `tenants`: `authenticated_read_tenants` (SELECT, anon+authenticated, true). There are no INSERT, UPDATE, or DELETE policies. This means:
- No application code can create a new tenant via the Supabase client (they hit RLS denial)
- Updates to tenant settings must go through a service role key (which bypasses RLS entirely)

This is likely the current working model (service role key in backend ENV), but it is undocumented and fragile. Define explicit service-role or admin-role policies.

### Invoice financial data cross-tenant readable
Pre-migration, `tenant_invoices_all` (public role, qual: true) meant anyone with a Supabase anon key and knowledge of an invoice UUID could read it. Post-migration, `tenant_invoices_select` still uses `qual: true` (not tenant-scoped) — the structural improvement is that it now excludes soft-deleted rows, but tenant isolation is still not enforced at the row level. Same auth hook fix from point 1 above resolves this.

### No audit log table
There is no append-only audit log for mutations to financial records (invoices, quotes). GDPR and basic financial compliance require knowing who changed what and when. The `lead_activities` table partially serves this for lead state, but invoice edits leave no trail. Recommendation: add an `audit_log` table before going live with real customers.

---

## 6. Migrations Applied Summary

| Migration Name | Status | Notes |
|---|---|---|
| add_composite_indexes | APPLIED | 7 composite indexes created |
| add_soft_delete_columns | APPLIED | deleted_at on smart_leads, invoices |
| add_tenant_metadata_columns | APPLIED | owner_email, subscription_tier, trial_started_at, settings on tenants |
| harden_rls_policies | APPLIED | 11 tables restructured, ~40 policies replaced |
| rebuild_tenant_metrics_view | APPLIED | Merged superset, soft-delete aware, invoice columns added |
| phase1_contacts_and_auto_reply | APPLIED | New contacts table (+RLS, +trigger); smart_leads.contact_id + auto-reply state cols; tenants.auto_reply config |
| phase1_catalogue_products_stock | APPLIED | New products table (+RLS, +trigger, unique tenant/sku) |
| phase1_rebuild_stock_movements_for_products | APPLIED | Dropped legacy inventory-bound orphan; rebuilt append-only ledger bound to products |
| phase1_escalations_and_outcome_tracking | APPLIED | New escalations table (+RLS, +trigger); smart_leads.escalation_status + escalated_at |
| phase1_retire_legacy_inventory | APPLIED | Dropped legacy inventory table; db.js repointed to products |
| phase1_team_members_and_activity_actor | APPLIED | lead_activities.actor_user_id; get_tenant_members + get_user_id_by_email SECURITY DEFINER fns |
| phase2_failed_ingestions_dead_letter | APPLIED (2026-07-02, version `20260702224053`) | New `failed_ingestions` dead-letter table (+RLS, temp anon-INSERT-only policy). See Section 8 for full detail and the temporary-RLS caveat. |
| phase2_atomic_stock_movement_rpc | **DRAFT — NOT APPLIED** | New `adjust_product_stock()` RPC (row-locked, atomic stock update + ledger insert). See Section 9. Pending database-lead/security-lead review. |

---

## 7. Recommended Next Actions (Priority Order)

1. **Implement auth.uid() → tenant_id mapping** — single biggest security fix. One trigger + one join table.
2. **Drop `interactions` zombie table** — after confirming zero code references.
3. **Fix `whatsapp_sessions.tenant_id` type** — VARCHAR → UUID.
4. **Add `updated_at` triggers** to smart_leads, smart_interactions, invoices, quotes.
5. **Resolve `plan` vs `subscription_tier` dual columns** on tenants.
6. **Add soft delete to `quotes` and `lead_activities`.**
7. **Add `tenant_id` to `closed_deals`** or consolidate into invoices.
8. **Add audit_log table** before any real customer data enters the system.
9. **Add `idx_email_threads_tenant_status`** composite index.
10. **Define ai_learning retention policy** before row count becomes a billing issue.

---

## 8. Applied — `phase2_failed_ingestions_dead_letter`

**Status: APPLIED.** Migration version `20260702224053`, applied 2026-07-02. The table exists, RLS is enabled, and the policy contract below has been verified live (read-only checks, not just the migration file). `engine.js`'s best-effort dead-letter writes are no longer no-ops.

Block 0's data-safety net (`Core Product & Vision/architecture.md` §6). `engine.js` (commit `3da2823`) attempts a best-effort write to this table on triage/parse failure, draft-generation failure, and the outer catch-all. Full migration file: `supabase/migrations/phase2_failed_ingestions_dead_letter.sql`. Reviewed by database-lead, security-lead, cto-ai.

**Post-apply verification (2026-07-02, all read-only):** `failed_ingestions` present in `public` schema with the exact columns/constraints/FK below; `pg_class.relrowsecurity = true`; `pg_policies` returns exactly one row for this table (`failed_ingestions_insert_temp_anon`, `roles={anon}`, `cmd=INSERT`, `with_check=true`) — confirming no SELECT/UPDATE/DELETE policy exists for `anon` or `authenticated`. Normal suite: 317 passed/9 skipped/0 failed (unchanged). Gated integration suite (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/failedIngestions.migration.test.js`): 8/8 passed, confirming the RLS/constraint contract against real Postgres.

**Integration-test rows left behind:** the "valid row inserts" and "anon can INSERT" test cases each created one row (2 total), all tagged `channel = '__integration_test__failed_ingestions_contract'`, `tenant_id = '00000000-0000-0000-0000-000000000001'`, `stage = 'triage'`. These are anon-INSERT-only rows the test client cannot itself read or delete (by design — see RLS caveat below); they need a service-role-side purge later, filtered on that channel value. Not yet purged as of this entry.

**Schema summary:** `id`, `tenant_id` (FK → `tenants(id)` ON DELETE CASCADE — verified 2026-07-02 via read-only SELECT that the dev-fallback tenant `00000000-0000-0000-0000-000000000001` exists), `tenant_id_source` (`brand_dna` | `default_fallback`), `channel`, `stage` (free-text, deliberately not CHECK-constrained — see rationale in the migration file header), `raw_payload` (TEXT, capped at 20,000 chars), `parsed_profile` (JSONB, capped at 20,000 chars serialized), `error_message`, `created_at`, `resolved_at`.

**⚠️ RLS caveat — temporary compromise, still live, not the target model:**
`engine.js` writes via `lib/supabase.js`'s client, which uses `SUPABASE_ANON_KEY`, not a service-role key. The applied migration therefore includes `CREATE POLICY "failed_ingestions_insert_temp_anon" ... FOR INSERT WITH CHECK (true)` — allowing the `anon` role to INSERT unconditionally. This is **not** the desired end state; it exists only because there is currently no service-role write path available to `engine.js`. `anon` SELECT/UPDATE/DELETE remain denied (no policy, confirmed live post-apply) — this table is service-role-only to read/triage until Block 1 lands.

**Tracked follow-up (do not lose this):** once Block 1 (tenant-scoping auth fix) is complete, replace `failed_ingestions` persistence with a server-side/service-role write path and **remove** the `failed_ingestions_insert_temp_anon` policy. This item should be added to the Block 1 completion checklist, not left as an implicit assumption.

---

## 9. Draft (NOT APPLIED) — `phase2_atomic_stock_movement_rpc`

**Status: DRAFT ONLY. Not applied. `apply_migration` has not been run.** Full migration file: `supabase/migrations/phase2_atomic_stock_movement_rpc.sql`. Pending database-lead and security-lead review before apply.

**Why:** Block 0's second data-safety-net item (atomic stock-movement update). A planning investigation (2026-07-03) against the live schema found that `controllers/products.js#adjustStock` performed a read → JS-computed balance → product `UPDATE` → `stock_movements` `INSERT` as three separate, unlocked round trips: two concurrent stock adjustments on the same product can lose an update (last write wins) while both still append a ledger row, silently diverging `products.stock_quantity` from `stock_movements`. Separately, `controllers/productImport.js` inserted an opening-stock `stock_movements` row on the assumption that a `BEFORE INSERT` trigger would update `products.stock_quantity` — **that trigger does not exist** (confirmed live via `information_schema.triggers` / `pg_trigger`, zero triggers on `stock_movements`), so every CSV-imported product with opening stock was silently staying at `stock_quantity = 0`.

**What it adds:** one function, `public.adjust_product_stock(p_tenant_id, p_product_id, p_delta, p_reason, p_note, p_allow_negative, p_created_by) RETURNS jsonb`. Inside a single call it does `SELECT ... FOR UPDATE` (row lock) → computes `balance_after` in SQL → blocks negative stock unless `p_allow_negative` → `UPDATE products` (stock_quantity + status) → `INSERT stock_movements` → returns `{"product": ..., "movement": ...}`. No table/column changes — function-only DDL.

**Key decisions (full rationale in the migration file header):**
- Named `adjust_product_stock`, **not** reusing the existing `apply_stock_movement()` name already present in the live DB — that function is dead/orphaned (references the dropped `public.inventory` table, unattached to any trigger). Left untouched; flagged as separate cleanup debt, not bundled here.
- **`SECURITY INVOKER` (default), not `SECURITY DEFINER`.** Checked live grants first: `anon` (the only role this backend uses — `lib/supabase.js` uses `SUPABASE_ANON_KEY`, no per-user sessions yet) already has table-level SELECT/INSERT/UPDATE on `products` and RLS already has tenant-scoped SELECT/INSERT/UPDATE policies on `products` and tenant-scoped SELECT/INSERT on `stock_movements`. A `SECURITY INVOKER` function runs as the calling role under those same RLS policies — no new privilege surface, no bypass of RLS to re-derive by hand. This is a deviation from the original plan draft (which assumed `SECURITY DEFINER` would be required) — **explicitly flagging for security-lead/database-lead sign-off.**
- Distinct SQLSTATEs for the two expected failure modes so the JS caller branches on `error.code`, not string-matching: `P0002` (Postgres's standard "no_data_found") for product-not-found/tenant-mismatch, and a custom `ISTOK` for insufficient stock without `allow_negative`.
- `lib/catalogue.js`'s `computeStockChange`/`deriveStatusFromStock` are **not deleted** — still unit-tested pure functions — but are no longer called from `adjustStock`'s write path; the RPC is now the sole authoritative source of `balance_after` and `status`.

**Call sites updated (code only). The app-code changes depend on this RPC existing. Do not deploy the controller changes to any live environment before the migration has been applied and verified, or stock adjustment/import opening-stock paths will fail:**
- `controllers/products.js#adjustStock` — now a single `supabase.rpc('adjust_product_stock', ...)` call; 404 mapped from `P0002`, 400 from `ISTOK`, 500 otherwise. No more pre-fetch, no more app-computed `balance_after`.
- `controllers/productImport.js` — opening-stock ledger write replaced with the same RPC call, fixing the "stock stays at zero" bug described above. Note: this is not a single product-create + opening-stock transaction — it remains a product `INSERT` followed by a separate `adjust_product_stock()` call. If the RPC call fails after the product insert succeeds, the product row remains created with `stock_quantity = 0` and the import response surfaces the failure as a row-level error (`results.errors`), same as the pre-fix behaviour. Accepted for this scoped Block 0.2 fix — a single atomic create+stock transaction is out of scope here.

**Tests added/changed:**
- `tests/catalogue.test.js` — `adjustStock` tests rewired to mock `supabase.rpc('adjust_product_stock', ...)` instead of the old `.update()`/`.insert()` chain; added a 500/unrecognised-error-code case.
- `tests/stockMovement.migration.test.js` (new, gated behind `RUN_DB_INTEGRATION_TESTS=true`, same pattern as `tests/failedIngestions.migration.test.js`) — happy path, oversell-blocked, `allow_negative`, nonexistent product, tenant-mismatch, and a 20-way concurrent `Promise.all` test using uniform `+1` deltas (so the resulting `balance_after` set is order-independent: a correct implementation must produce exactly `base+1..base+20` with no duplicates/gaps; a lost update would show up as a duplicate or missing value and a final `stock_quantity` below `base+20`).

**Risks / rollback:** Low-to-medium. `CREATE OR REPLACE FUNCTION` / a future `DROP FUNCTION` is trivially reversible — no data migration, no backfill, no destructive step. Main risk is a tenant-scoping bug inside a function that (even under `SECURITY INVOKER`) still does its own explicit `WHERE tenant_id = p_tenant_id` filtering; this mirrors the same category of concern already accepted for the `SECURITY DEFINER` helpers in Migration 11 (`get_tenant_members`, `get_user_id_by_email`), though this function carries less risk since it does not elevate privilege.

**Explicitly out of scope (per accepted plan):** quote/invoice stock consumption (no such path exists in the app today), the auto-reply sweeper claim-lock (Block 0's other remaining item), the `auth.uid() → tenant_id` RLS mapping gap (Block 1), and dropping the orphaned `apply_stock_movement()` / `prevent_stock_movement_mutation()` functions (tracked as follow-up debt, item below).

**New follow-up debt to track:** drop `apply_stock_movement()` (references the already-dropped `inventory` table) and `prevent_stock_movement_mutation()` (unattached, superseded by RLS) in a small, separate hygiene migration once someone reviews that neither is depended on anywhere unexpected.

**Not yet done:** migration not applied; `DB_AUDIT_REPORT.md`'s Section 6 table will need its status flipped to APPLIED (with version + date) once `apply_migration` runs; gated integration suite not yet executed (requires the function to exist).

**Pre-commit fix — PATCH bypass found during database/security review:** the joint database-lead/security-lead review of this draft surfaced that `productUpdateSchema` (`lib/catalogue.js`) was `productSchema.partial()`, which still allowed `stock_quantity` and `status` through the generic `PATCH /api/products/:id` (`controllers/products.js#updateProduct`) with no `stock_movements` entry — silently bypassing this entire RPC and the ledger it's meant to keep in sync. Fixed before commit: `productUpdateSchema` now explicitly omits `stock_quantity`/`status` and is `.strict()`, so a PATCH containing either field is rejected with 400 rather than silently stripped or applied. Stock changes must go through `POST /api/products/:id/stock` (→ `adjust_product_stock()`). Covered by new tests in `tests/catalogue.test.js` (`productUpdateSchema`, `updateProduct` describe blocks).
