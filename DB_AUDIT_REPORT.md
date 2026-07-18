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
| phase2_atomic_stock_movement_rpc | APPLIED (2026-07-03, version `20260703184137`) | New `adjust_product_stock()` RPC (row-locked, atomic stock update + ledger insert). See Section 9 for full detail. |
| phase2_atomic_stock_movement_rpc_grants_fix | APPLIED (2026-07-03, version `20260703184604`) | Post-apply fix — revoked implicit `PUBLIC`/`authenticated` EXECUTE grants picked up on function creation; see Section 9. |
| phase2_sweeper_claim_lock | APPLIED (2026-07-06, version `20260706142919`) | New `smart_leads.claimed_at` column — atomic claim-lock preventing sweeper double-send. See Section 10 for full detail, including the systemic RLS finding surfaced during its review. |
| phase_0_2_adjust_product_stock_authenticated_grant | APPLIED (2026-07-12, version `20260712144148`) | Grant-only fix — added `authenticated` to `adjust_product_stock()`'s EXECUTE grant after Block 1's JWT-authenticated request clients became the real call path. See Section 11 for full detail. |
| phase_1_5b_drop_invoices_permissive_policy | APPLIED (2026-07-14) | Dropped `invoices`' 4 legacy permissive policies; all 4 scoped `invoices_tenant_*` siblings kept — full CRUD coverage retained. See Section 14. |
| phase_1_6b_drop_quotes_permissive_policy | APPLIED (2026-07-14) | Dropped `quotes`' 4 legacy permissive policies; 3 scoped `quotes_tenant_*` siblings kept (SELECT/INSERT/UPDATE) — no scoped DELETE added, so DELETE is now default-deny by design. See Section 15. |
| phase_1_7b_drop_smart_leads_permissive_policy | APPLIED (2026-07-16) | Dropped `smart_leads`' 4 legacy permissive policies; all 4 scoped `smart_leads_tenant_*` siblings kept — full CRUD coverage retained; SELECT policy additionally amended to add `AND deleted_at IS NULL` for soft-delete parity with the legacy policy it replaced. See Section 16. |
| phase_1_8_drop_call_logs_permissive_policy | APPLIED (2026-07-16) | Dropped `call_logs`' 3 legacy permissive policies (no DELETE policy existed to drop); added one new scoped `call_logs_tenant_insert` policy — the only command with an app dependent. SELECT/UPDATE default-deny by design; DELETE remains default-deny (unchanged). See Section 17. |
| phase_1_9_drop_segments_permissive_policy | APPLIED (2026-07-17) | Dropped `segments`' 4 legacy permissive policies; added three new scoped `segments_tenant_*` policies (SELECT/INSERT/UPDATE — all three have live frontend anon dependents). No scoped DELETE added, so DELETE is now default-deny by design. Policy count 4 → 3. See Section 18. |
| phase_1_10b_drop_smart_interactions_permissive_policy | APPLIED (2026-07-18) | Dropped `smart_interactions`' 4 legacy permissive policies; SELECT/INSERT already had correct scoped siblings (kept unchanged); added one new scoped `smart_interactions_tenant_update` policy with an explicit `WITH CHECK` (not just `USING`), since `tenant_id` is nullable on this table and its Lane C UPDATE dependents in `drafts/page.tsx` are unauthenticated with no app-level tenant filter. No scoped DELETE added, so DELETE is now default-deny by design. Policy count 6 → 3. See Section 19. |

---

## 7. Recommended Next Actions (Priority Order)

1. **Implement auth.uid() → tenant_id mapping** — single biggest security fix. One trigger + one join table. **SHOWSTOPPER, confirmed and sharpened during Block 0.3 review (2026-07-06, see Section 10); partially resolved 2026-07-12–2026-07-18 (see Sections 12–19):** 1 table (`whatsapp_sessions`) still carries an older, more permissive RLS policy set (e.g. `qual = true`, or a bare `deleted_at IS NULL` check with no tenant predicate at all) running *alongside* the newer tenant-scoped policies. Since Postgres OR's multiple permissive policies together, the permissive set wins — this table is effectively **not tenant-isolated today**, regardless of the newer policies' existence. Supabase's own security advisor independently flags this (`rls_policy_always_true`). **No real client/production traffic should touch this remaining table until this is fixed as part of Block 1** — this is not a "nice to have," it blocks launch. `email_threads`, `closed_deals`, `invoices`, `quotes`, `smart_leads`, `call_logs`, `segments`, and `smart_interactions` (8 of the original 9 tables) have had their legacy permissive policies dropped — 2026-07-12 for the first two (Block 1.4b/1.4c), 2026-07-14 for `invoices` (Block 1.5b, see Section 14) and `quotes` (Block 1.6b, see Section 15), 2026-07-16 for `smart_leads` (Block 1.7b, see Section 16) and `call_logs` (Block 1.8, see Section 17), 2026-07-17 for `segments` (Block 1.9, see Section 18), and 2026-07-18 for `smart_interactions` (Block 1.10b, see Section 19) — and are no longer part of this SHOWSTOPPER. `email_threads` is now RLS default-deny for all roles; `closed_deals` retains its correct tenant-scoped SELECT/INSERT policies, with UPDATE/DELETE now default-deny; `invoices` retains correct tenant-scoped SELECT/INSERT/UPDATE/DELETE policies for all four commands; `quotes` retains correct tenant-scoped SELECT/INSERT/UPDATE policies, with DELETE now default-deny by design (no delete route/UI/app code exists); `smart_leads` retains correct tenant-scoped SELECT/INSERT/UPDATE/DELETE policies for all four commands, with its SELECT policy additionally amended to add `AND deleted_at IS NULL` for soft-delete parity with the legacy policy it replaced; `call_logs` had zero scoped policies before Block 1.8, so a new `call_logs_tenant_insert` policy had to be added (not just legacy ones dropped) to keep its one real app dependent (INSERT) working; SELECT and UPDATE are now default-deny by design (no app dependents for either), joining DELETE (already default-deny before this migration touched anything); `segments` also had zero scoped policies before Block 1.9 — a harder case than `call_logs`, since three commands (SELECT, INSERT, UPDATE) all have live frontend anon-client dependents (list view, "Save Segment" form, and the "Run Campaign" button's `last_run_at` update) and all three needed new scoped policies added, not just one; DELETE has no app dependent and is now default-deny by design, the same reasoning as `quotes`' DELETE; `smart_interactions` (Block 1.10b) was the opposite shape — SELECT and INSERT already had correct scoped siblings, so only UPDATE needed a new scoped policy, and that policy was given an explicit `WITH CHECK` (identical to its `USING` clause) rather than relying on Postgres' implicit fallback, since `smart_interactions.tenant_id` is nullable (unlike its NOT NULL siblings in this family) and its three live UPDATE dependents in `drafts/page.tsx` (Dismiss, Escalate, Save-and-Send) are raw unauthenticated anon calls with no app-level tenant filter of any kind; DELETE has no app dependent (its only known caller anywhere in the repo is gated `autoReplySweeper` test cleanup, not production code) and is now default-deny by design — all eight surviving-policy tables are still on the interim dev-fallback-tenant policy branch, not yet final `auth.uid()`-based production isolation.
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

## 9. Applied — `phase2_atomic_stock_movement_rpc` (+ grants fix)

**Status: APPLIED.** Migration version `20260703184137`, applied 2026-07-03, followed by a post-apply grants-fix migration version `20260703184604` the same day. `public.adjust_product_stock(...)` exists live in Supabase project `lmslyfxvvnvjojsymehy`, verified read-only post-apply (below). Full migration files: `supabase/migrations/phase2_atomic_stock_movement_rpc.sql`, plus the grants fix (applied directly via `apply_migration`, not committed as a separate repo file — see "Post-apply grants fix" below). Reviewed by database-lead and security-lead (both GO WITH CONDITIONS; the one pre-commit condition — the `productUpdateSchema` PATCH bypass — was fixed before commit, see below).

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

**Pre-commit fix — PATCH bypass found during database/security review:** the joint database-lead/security-lead review of this draft surfaced that `productUpdateSchema` (`lib/catalogue.js`) was `productSchema.partial()`, which still allowed `stock_quantity` and `status` through the generic `PATCH /api/products/:id` (`controllers/products.js#updateProduct`) with no `stock_movements` entry — silently bypassing this entire RPC and the ledger it's meant to keep in sync. Fixed before commit: `productUpdateSchema` now explicitly omits `stock_quantity`/`status` and is `.strict()`, so a PATCH containing either field is rejected with 400 rather than silently stripped or applied. Stock changes must go through `POST /api/products/:id/stock` (→ `adjust_product_stock()`). Covered by new tests in `tests/catalogue.test.js` (`productUpdateSchema`, `updateProduct` describe blocks).

**Post-apply verification (2026-07-03, all read-only):** `SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'adjust_product_stock'` returns exactly 1 row — `public.adjust_product_stock(p_tenant_id uuid, p_product_id uuid, p_delta integer, p_reason text, p_note text, p_allow_negative boolean, p_created_by uuid)`, `prosecdef = false` (confirming `SECURITY INVOKER`, as reviewed and intended). `pg_get_functiondef` confirms the live body matches the committed SQL byte-for-byte — no drift.

**Post-apply grants fix (2026-07-03, version `20260703184604`):** raw ACL inspection (`pg_proc.proacl`) immediately after the first apply showed `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — i.e. `PUBLIC` and `authenticated` both had EXECUTE, neither intended by the reviewed migration. Root cause: Postgres grants EXECUTE to `PUBLIC` by default on function creation (unlike tables), and this Supabase project has schema-level default privileges that auto-grant EXECUTE to `anon`/`authenticated`/`service_role` on every new `public`-schema function unless revoked — the reviewed migration's explicit `GRANT ... TO anon` never accounted for either default. Fixed same-day with a follow-up migration (`REVOKE EXECUTE ... FROM PUBLIC`, `REVOKE EXECUTE ... FROM authenticated`, re-affirming `GRANT EXECUTE ... TO anon`; function body untouched). Verified post-fix: `proacl` is now exactly `{postgres=X/postgres, anon=X/postgres, service_role=X/postgres}` — `PUBLIC` and `authenticated` both absent, `anon` present, `postgres`/`service_role` present as expected (owner + Supabase's elevated backend role, outside this app's client-facing trust boundary). **This grants-fix SQL was applied directly via `apply_migration` and is not yet committed as a repo-tracked `.sql` file** — added to follow-up debt below so this doesn't silently drift from what's actually live.

**Gated integration suite** (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/stockMovement.migration.test.js`), run against the now-live function after both migrations: **1 test file passed, 6/6 tests passed, 0 skipped, 0 failed.** This included the 20-way concurrent `+1`-delta test (`Promise.all` against the same product) — passed, confirming `SELECT ... FOR UPDATE` genuinely serializes concurrent writers on live Postgres, not just in the reviewed SQL — and the tenant-mismatch/cross-tenant-rejection test — passed, confirming the function's explicit `tenant_id = p_tenant_id` filter correctly rejects a mismatched tenant with `P0002` and leaves the real product untouched.

**Normal suite**, re-run after the gated suite passed: **29 test files passed | 2 skipped (31); 326 tests passed | 16 skipped | 0 failed (342).** No regressions from either migration or from the `productUpdateSchema` fix.

**Follow-up debt (updated):**
- Commit the grants-fix SQL as its own tracked file in `supabase/migrations/` (e.g. `phase2_atomic_stock_movement_rpc_grants_fix.sql`) so the repo reflects what's actually live, not just this audit entry.
- Drop `apply_stock_movement()` / `prevent_stock_movement_mutation()` (see above).
- Consider auditing other/future RPCs in this project for the same implicit-`PUBLIC`/default-privilege grant gap found here — this wasn't caught by the original migration review because both reviewers reasoned from the migration file's explicit `GRANT` line, not from Postgres's default-grant behavior for new functions or this project's schema-level default privileges.

**Block 0 status: still not complete.** This closes Block 0's second item (atomic stock-movement update). Block 0.3 — the auto-reply sweeper claim-lock — remains unbuilt. Block 1 (tenant auth/RLS cleanup) is not started. Decision Brain implementation is not started. Do not treat Block 0 as cleared until Block 0.3 also lands and is verified.

---

## 10. Applied — `phase2_sweeper_claim_lock`

**Status: APPLIED.** Migration version `20260706142919`, applied 2026-07-06 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase2_sweeper_claim_lock.sql`. Reviewed by database-lead (GO) and security-lead (GO WITH CONDITIONS) before apply.

**Why:** Block 0's third and final data-safety-net item (auto-reply sweeper claim-lock). `lib/autoReplySweeper.js#sweepScheduledReplies` fetches due leads and dispatches a real customer-facing WhatsApp/email message with no claim/lock in place beforehand — only the *final* "mark sent" write was guarded (`.eq('auto_reply_status','scheduled')`), which protects the status transition but does nothing to stop two overlapping sweeper runs (overlapping `setInterval` ticks, two processes during a rolling deploy, a supervisor restart racing an in-flight tick) from both dispatching the same message before either updates the row. This is a double-send bug, not a ledger-integrity bug — the status ends up correct either way — but a customer could receive the same message twice.

**What it adds:** one column, `smart_leads.claimed_at TIMESTAMPTZ` (nullable, no default), plus a `COMMENT ON COLUMN` explaining its contract. No other DDL — no new table, no CHECK constraint change, no RLS/policy change, no GRANT/REVOKE statement.

**Post-apply verification (2026-07-06, all read-only):**
- `information_schema.columns` confirms `smart_leads.claimed_at` exists live: `data_type = timestamp with time zone`, `is_nullable = YES`, `column_default = NULL`.
- `col_description` confirms the column comment exists and matches the reviewed migration text exactly.
- `pg_policies` for `smart_leads` is identical before and after this migration — **no RLS policies were added, removed, or modified.**
- `information_schema.role_table_grants` for `anon`/`authenticated` on `smart_leads` is identical before and after — **no grants were changed.** (This migration adds no function and no `GRANT`/`REVOKE` statement, so it carries none of the implicit-default-privilege risk found with Block 0.2's RPC.)

**Implementation ([lib/autoReplySweeper.js](../lib/autoReplySweeper.js)):** dispatch is now "claim, then act." Before any dispatch attempt, a single atomic conditional `UPDATE ... WHERE auto_reply_status = 'scheduled' AND (claimed_at IS NULL OR claimed_at < staleBefore)` is issued. Only one concurrent caller can win that UPDATE for a given row; the loser's WHERE re-evaluates post-commit and matches zero rows, so it skips instead of double-dispatching. A claim expires after 5 minutes (`CLAIM_STALE_MS`) so a crashed sweeper's stuck claim self-heals with no manual intervention; an ordinary (non-crash) dispatch failure explicitly releases the claim (`claimed_at = NULL`) so the very next tick can retry immediately rather than waiting out the staleness window.

Chose a plain conditional UPDATE over a Postgres RPC using `SELECT ... FOR UPDATE SKIP LOCKED`: this backend has no raw-SQL/transaction access (Supabase JS client over PostgREST only, same as everywhere else in this codebase) — `FOR UPDATE SKIP LOCKED` would need to be wrapped in a new function regardless, and a single conditional UPDATE already gives the same per-row exclusivity for this access pattern (claim one row at a time, not a batch dequeue), consistent with the "mark sent" guard this file already used before this change.

**Tests:**
- `tests/autoReplySweeper.test.js` (mocked) — extended to cover the claim step, including a genuine concurrency-race test using a stateful shared-row fake (two `Promise.all`'d calls against one shared object, proving `dispatch` fires exactly once), plus stale-claim recovery and fresh-claim non-recovery cases. **22/22 passed.**
- `tests/autoReplySweeper.migration.test.js` (new, gated behind `RUN_DB_INTEGRATION_TESTS=true`, same convention as `tests/stockMovement.migration.test.js`) — run against the now-live column: **`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/autoReplySweeper.migration.test.js` → 5 passed / 0 skipped / 0 failed.** Includes a **30-concurrent-sweep-pass test on one real due lead** — `dispatch` fired exactly once, `claimLost` totalled 29, proving the row-level claim genuinely serializes concurrent writers on live Postgres (not just in the reviewed logic).
- **Two test-file bugs surfaced on the first gated run and were fixed** (neither was a migration or application-logic defect):
  1. Cleanup-ordering bug — `afterEach` deleted `smart_leads` rows directly, but `smart_interactions.lead_id` has no `ON DELETE CASCADE` (unlike `stock_movements.product_id`, which is cascade) — fixed by deleting drafts before leads.
  2. Timestamp comparison bug — asserted `claimed_at` with strict string equality; Postgres round-trips a `...772Z` JS timestamp as `...772+00:00` (same instant, different string) — fixed by comparing `Date.getTime()` values instead.
  - The first (failed) run's test rows were purged directly (read-only-safe, dev-fallback-tenant test data only); a final check confirmed **0 leftover rows** tagged with the test's `company_name` marker after the corrected run.
- Full normal suite after all of the above: **`npm test` → 330 passed / 22 skipped / 0 failed.**

**⚠️ Critical finding surfaced during this migration's review — NOT fixed by this migration at the time, one of the 9 tables since resolved (see Section 12):**
Reviewing this change surfaced that `smart_leads` (and, per a broader `get_advisors` security-advisor check the security-lead review ran, at least 8 other tables — `closed_deals`, `invoices`, `quotes`, `email_threads`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions`) carry **two overlapping RLS policy sets per command**: a newer, correctly tenant-scoped set (e.g. `smart_leads_tenant_update`, using `auth_tenant_id() OR dev-fallback-tenant`) coexisting with an older, permissive set (e.g. `tenant_leads_update` with `qual = true`, `tenant_leads_select` with `qual = deleted_at IS NULL` and no tenant check at all). Postgres OR's multiple permissive policies together, so **the permissive set wins** — these tables are effectively **not tenant-isolated today**, independent of anything in Block 0 (0.1, 0.2, or 0.3). Supabase's own security advisor independently flags this pattern as `rls_policy_always_true`.

This is **pre-existing debt, not introduced or worsened by `phase2_sweeper_claim_lock`** (confirmed: `claimed_at` carries no sensitive data, and the claim UPDATE's WHERE clause doesn't reference `tenant_id` in either direction — it neither adds nor removes a boundary). It is explicitly **out of scope for Block 0.3** and was **not fixed here**, per direct instruction — fixing it now would mean dropping/rewriting legacy policies mid-Block-0, untested against Block 1's forthcoming `auth.uid()`-mapping model.

**This was a Block 1 pre-launch SHOWSTOPPER across all 9 tables**, reflected in Section 7 item 1 above. `email_threads` was removed from this list 2026-07-12 via Block 1.4b (Section 12) — it had zero confirmed application-code dependents, so its legacy policies were dropped with no replacement, converting it to default-deny. `closed_deals` was removed from this list the same day via Block 1.4c (Section 13) — it also had zero confirmed application-code dependents, and already had correct tenant-scoped SELECT/INSERT policies to fall back on, so only its legacy policies were dropped; UPDATE/DELETE are now default-deny. `invoices` was removed from this list 2026-07-14 via Block 1.5b (Section 14) — its blockers (a `billing.js` client-usage gap and a raw anon Realtime subscription) were resolved first, then its legacy policies were dropped; all four scoped `invoices_tenant_*` policies (SELECT/INSERT/UPDATE/DELETE) were already correct and are kept unchanged, so `invoices` retains full CRUD coverage under the interim dev-fallback-tenant policy branch. `quotes` was removed from this list the same day via Block 1.6b (Section 15) — its blockers (missing authenticated backend routes and raw frontend Supabase/Realtime access) were resolved first (`ea65df3`, `07de268`), then its legacy policies were dropped; the three scoped `quotes_tenant_*` policies (SELECT/INSERT/UPDATE) were already correct and are kept unchanged, but no scoped DELETE policy was added — DELETE is now default-deny by design, since no delete route, UI action, or other application code deletes a quote anywhere in this codebase. **The remaining 5 tables (`smart_leads`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions`) are still an open SHOWSTOPPER.** No real client/production traffic should route through any of them until Block 1's `auth.uid() → tenant_id` mapping lands and their legacy permissive policies are dropped — that acceptance criterion should be explicit in Block 1's own scope, not an afterthought.

**Block 0 status: complete once this entry and the corresponding changelog entry are committed.** All three Block 0 items — `failed_ingestions` (0.1), atomic stock-movement RPC (0.2), and sweeper claim-lock (0.3) — are now applied and verified. A follow-up authenticated-role grant for the stock RPC has also been applied and verified after Block 1 introduced JWT-authenticated request clients. Block 1 tenant auth/RLS cleanup is in progress, including the SHOWSTOPPER above. Decision Brain implementation is not started.

---

## 11. Applied — `phase_0_2_adjust_product_stock_authenticated_grant`

**Status: APPLIED.** Migration file: `supabase/migrations/phase_0_2_adjust_product_stock_authenticated_grant.sql`.

**Purpose:** Grant `authenticated` EXECUTE on `public.adjust_product_stock(UUID, UUID, INTEGER, TEXT, TEXT, BOOLEAN, UUID)` after Block 1 JWT-authenticated request clients became the real call path for stock adjustment/import. Block 0.2's RPC was originally granted to `anon` only, correct for the pre-Block-1 world where every backend request ran as `anon` — Block 1's `requireAuth` middleware now routes real requests through a JWT-authenticated client instead, and that role had never been granted EXECUTE, so real authenticated stock-adjustment/import calls were failing with permission-denied until this migration.

**Safety:** Function remains `SECURITY INVOKER`. Function body unchanged. RLS policies on `products` and `stock_movements` unchanged. No table grants changed — this is an EXECUTE grant on the function only. This does not bypass tenant RLS: `SECURITY INVOKER` means the function still runs as the calling role, subject to that role's RLS policies, exactly as before.

**Verification (read-only, before and after apply):**
- Live ACL now includes: `{postgres=X/postgres, anon=X/postgres, service_role=X/postgres, authenticated=X/postgres}`.
- `SECURITY INVOKER` confirmed via `prosecdef = false`.
- `pg_get_functiondef` before vs. after matched byte-for-byte — no body drift.
- `pg_policies` on `products` and `stock_movements` unchanged before vs. after.

---

## 12. Applied — `phase_1_4b_drop_email_threads_permissive_policy`

**Status: APPLIED.** Applied 2026-07-12 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_4b_drop_email_threads_permissive_policy.sql`. Committed draft-only in `190d144`, applied only after a separate Command Room approval for this specific migration.

**Why:** Block 1.4's planning audit (`claude-code-migration/docs/BLOCK_1_4_LEGACY_RLS_POLICY_REMOVAL_AUDIT.md`) identified `email_threads` as the sole safe-removal candidate among the 9 tables named in the Section 7/10 SHOWSTOPPER: a live `pg_policies` query confirmed it carried exactly three permissive policies with no tenant-scoped sibling of any kind, and a repo-wide code search confirmed zero application code (routes, controllers, lib, frontend, or tests) references this table — no Lane A, Lane B, or Lane C path depends on it.

**What it removed:** the three legacy permissive policies on `email_threads`, no replacement created:
- `tenant_email_threads_select` (SELECT, `USING true`)
- `tenant_email_threads_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`)
- `tenant_email_threads_update` (UPDATE, `USING true`)

**Result:** `email_threads` now has RLS enabled with zero policies defined, so it is fully default-deny for every role and every command (SELECT/INSERT/UPDATE/DELETE), until a properly tenant-scoped policy is intentionally designed alongside whatever feature first needs to read/write this table.

**Verification (2026-07-12, all read-only):**
- Before apply: `pg_policies` for `email_threads` returned the 3 policies listed above.
- `apply_migration` returned success.
- After apply: `pg_policies` for `email_threads` returns **zero rows**. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled, just with no policies.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/emailThreads.migration.test.js`): **3/3 passed** — anon SELECT returns empty, anon INSERT rejected with an RLS-violation error, anon UPDATE matches zero rows.
- Policy counts on the other checked tables were re-checked and are unchanged: `smart_leads`=8, `invoices`=8, `quotes`=7, `smart_interactions`=6, `closed_deals`=5, `segments`=4, `tenants`=3, `call_logs`=3, `lead_activities`=3, `segment_runs`=2, `whatsapp_sessions`=1. Nothing else was touched.

**Block 1 status (at the time of this entry):** this closes Block 1.4b. The Section 7/10 SHOWSTOPPER was reduced from 9 tables to 8: `smart_leads`, `closed_deals`, `invoices`, `quotes`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions` remained effectively not tenant-isolated. `closed_deals` was subsequently also resolved the same day via Block 1.4c — see Section 13 for the current 7-table count. Per the Block 1.4a audit, broader removal across the remaining tables stays blocked on (a) a Lane B tenant-safe write path (deferred Block 1.3 RPCs, or an accepted narrowed dev-fallback policy) and (b) a Command Room triage decision on "Lane C" (frontend pages querying Supabase directly with no JWT and a hardcoded tenant). Decision Brain implementation is not started.

---

## 13. Applied — `phase_1_4c_drop_closed_deals_permissive_policy`

**Status: APPLIED.** Applied 2026-07-12 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_4c_drop_closed_deals_permissive_policy.sql`. Committed draft-only in `fdce71f`, applied only after a separate Command Room approval for this specific migration.

**Why:** Following Block 1.4b (`email_threads`), a Lane C triage audit identified `closed_deals` as the next safe-removal candidate: a live `pg_policies` query confirmed it carried three legacy permissive policies alongside two already-correct tenant-scoped sibling policies, and a repo-wide code search confirmed zero application code (routes, controllers, lib, frontend, or tests) references this table — it appears only in a generated TypeScript type declaration, never queried.

**What it removed:** the three legacy permissive policies on `closed_deals`, no replacement created — the existing scoped siblings were left untouched:
- `closed_deals_select` (SELECT, `USING true`) — dropped
- `closed_deals_insert` (INSERT, `WITH CHECK true`) — dropped
- `closed_deals_update` (UPDATE, `USING true`) — dropped
- `closed_deals_tenant_select` (SELECT, `tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>`) — kept, unchanged
- `closed_deals_tenant_insert` (INSERT, same condition) — kept, unchanged

**Result:** unlike `email_threads`, `closed_deals` is not fully default-deny — SELECT and INSERT remain usable, scoped to a tenant via the existing `closed_deals_tenant_*` policies (including their pre-auth-mapping dev-fallback branch, not yet the final production model). UPDATE and DELETE now have no policy at all and are fully default-deny for every role.

**Verification (2026-07-12, all read-only):**
- Before apply: `pg_policies` for `closed_deals` returned 5 policies (the 3 legacy + 2 scoped listed above).
- `apply_migration` returned success.
- After apply: `pg_policies` for `closed_deals` returns exactly 2 rows — `closed_deals_tenant_select` and `closed_deals_tenant_insert`, both byte-for-byte unchanged. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/closedDeals.migration.test.js`): **4/4 passed** — anon INSERT succeeds for the dev-fallback tenant, anon INSERT with a mismatched tenant is rejected with an RLS-violation error, the dev-fallback-tenant row is visible via the scoped SELECT policy, anon UPDATE matches zero rows. Per the test file's own header, this does not prove cross-tenant SELECT isolation against a pre-existing other-tenant row (no second real tenant exists to test against) — that remains open work, deferred to Block 1.9.
- Policy counts on the other checked tables were re-checked and are unchanged: `smart_leads`=8, `invoices`=8, `quotes`=7, `smart_interactions`=6, `segments`=4, `tenants`=3, `call_logs`=3, `lead_activities`=3, `segment_runs`=2, `whatsapp_sessions`=1. Nothing else was touched.

**Block 1 status:** this closes Block 1.4c. The Section 7/10 SHOWSTOPPER is now reduced to 7 tables: `smart_leads`, `invoices`, `quotes`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Per the Lane C triage audit, each of these 7 is blocked for a distinct, specific reason (missing backend routes for `quotes`/`segments`, a `billing.js` client-usage gap for `invoices`, no scoped sibling policy at all for `call_logs`, a column-type fix for `whatsapp_sessions`, and heavy multi-page Lane C usage plus deferred Block 1.3 RPC work for `smart_leads`/`smart_interactions`) — see the Lane C triage report for the full breakdown. Decision Brain implementation is not started. `invoices`' blocker was subsequently resolved and its legacy policies dropped 2026-07-14 via Block 1.5b — see Section 14 for the current 6-table count.

---

## 14. Applied — `phase_1_5b_drop_invoices_permissive_policy`

**Status: APPLIED.** Applied 2026-07-14 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_5b_drop_invoices_permissive_policy.sql`. Committed draft-only in `b05bf29`, applied only after a separate Command Room approval for this specific migration.

**Why:** `invoices`' Block 1.4c-era blocker — `controllers/billing.js` using a raw, non-tenant-scoped Supabase client, and `invoices/page.tsx` holding a raw anon Realtime subscription — was resolved first (`billing.js` now uses `req.supabase`/`req.tenantId`, commit `c3fdf80`; the Realtime subscription was removed, commit `508a181`). A follow-up repo-wide search then confirmed zero remaining application code (routes, controllers, lib, frontend, tests) queries `invoices` via a raw Supabase client outside the authenticated, per-request, tenant-scoped path — clearing `invoices` as the next safe-removal candidate after `email_threads` (1.4b) and `closed_deals` (1.4c). A live `pg_policies` query confirmed `invoices` carried 4 legacy permissive policies alongside 4 already-correct tenant-scoped sibling policies, one per command.

**What it removed:** the four legacy permissive policies on `invoices`, no replacement created — the existing scoped siblings were left untouched:
- `tenant_invoices_select` (SELECT, `USING deleted_at IS NULL`) — dropped
- `tenant_invoices_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped
- `tenant_invoices_update` (UPDATE, `USING true`) — dropped
- `tenant_invoices_delete` (DELETE, `USING true`) — dropped
- `invoices_tenant_select` (SELECT, `tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>`) — kept, unchanged
- `invoices_tenant_insert` (INSERT, same condition) — kept, unchanged
- `invoices_tenant_update` (UPDATE, same condition) — kept, unchanged
- `invoices_tenant_delete` (DELETE, same condition) — kept, unchanged

**Result:** unlike `email_threads` (fully default-deny) or `closed_deals` (SELECT/INSERT only), `invoices` keeps a correct scoped policy for **all four** commands — the cleanest of the three drops so far, with no coverage gap on any CRUD operation. Cross-tenant access (a request matching neither `auth_tenant_id()` nor the dev-fallback tenant) is now denied at the database layer instead of relying solely on app-layer `.eq('tenant_id', ...)` filtering. As with `closed_deals`, the surviving policies' `OR tenant_id = <dev-fallback-tenant>` branch is an interim pre-auth-mapping scaffold, not the final production model — it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).

**Verification (2026-07-14, after approved live apply):**
- Before apply: `pg_policies` for `invoices` returned 8 policies (the 4 legacy + 4 scoped listed above).
- `apply_migration` returned success.
- After apply: `pg_policies` for `invoices` returns exactly 4 rows — the `invoices_tenant_*` set, byte-for-byte unchanged. `pg_class.relrowsecurity = true` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/invoices.migration.test.js`): **5/5 passed** — anon INSERT succeeds for the dev-fallback tenant, anon INSERT with a nonexistent tenant is rejected, the dev-fallback-tenant row is visible via the scoped SELECT policy, and (new relative to the `closed_deals` test — `invoices` retains scoped UPDATE/DELETE) anon UPDATE and anon DELETE on a dev-fallback-tenant row both succeed. Per the test file's own header, the mismatched-tenant INSERT rejection cannot be isolated to RLS alone versus the table's FK on `tenant_id` (only one tenant row exists in this project) — a stronger, RLS-only assertion needs a second seeded tenant row, the same open work as cross-tenant SELECT isolation (Block 1.9).
- Default skip-mode (`npx vitest run tests/invoices.migration.test.js`): 6/6 skipped, as intended outside manual/CI-gated runs.
- `tests/billing.test.js`: 26/26 passed.
- Full suite: `npm test` → 395 passed / 37 skipped / 0 failed.
- Policy counts on the other checked tables were re-checked and are unchanged: `smart_leads`=8, `quotes`=7, `smart_interactions`=6, `closed_deals`=2, `segments`=4, `call_logs`=3, `whatsapp_sessions`=1. Nothing else was touched.

**Block 1 status:** this closes Block 1.5b. The Section 7/10 SHOWSTOPPER is now reduced to 6 tables: `smart_leads`, `quotes`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Decision Brain implementation is not started.

---

## 15. Applied — `phase_1_6b_drop_quotes_permissive_policy`

**Status: APPLIED.** Applied 2026-07-14 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_6b_drop_quotes_permissive_policy.sql`. Committed draft-only in `41fbc2c`, applied only after a separate Command Room approval for this specific migration.

**Why:** `quotes`' blockers — no authenticated backend CRUD routes, and both `quotes/page.tsx` and `quotes/new/page.tsx` reading/writing `quotes` via a raw anon Supabase client (plus an unfiltered Realtime subscription on the list page and a hardcoded dev-fallback `tenant_id` on quote creation) — were resolved first: `ea65df3` added `GET/GET:id/POST/PATCH /api/quotes` using `req.supabase`/`req.tenantId` only, and `07de268` migrated both quote pages onto those authenticated routes, removing the raw client usage, the Realtime subscription, the hardcoded `tenant_id`, and the client-generated `quote_number` in the process. A follow-up repo-wide search confirmed zero remaining application code (routes, controllers, lib, frontend, tests) queries `quotes` via a raw Supabase client outside that per-request, tenant-scoped path — clearing `quotes` as the next safe-removal candidate after `invoices` (1.5b). A live `pg_policies` query confirmed `quotes` carried 4 legacy permissive policies alongside 3 already-correct tenant-scoped sibling policies (no scoped DELETE sibling existed, unlike `invoices`).

**What it removed:** the four legacy permissive policies on `quotes`, no replacement created — the existing scoped siblings were left untouched, and no DELETE replacement was added:
- `tenant_quotes_select` (SELECT, `USING true`) — dropped
- `tenant_quotes_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped
- `tenant_quotes_update` (UPDATE, `USING true`) — dropped
- `tenant_quotes_delete` (DELETE, `USING true`) — dropped
- `quotes_tenant_select` (SELECT, `tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>`) — kept, unchanged
- `quotes_tenant_insert` (INSERT, same condition) — kept, unchanged
- `quotes_tenant_update` (UPDATE, same condition) — kept, unchanged

**Result:** unlike `invoices` (correct scoped policy for all four commands), `quotes` keeps a correct scoped policy for **SELECT/INSERT/UPDATE only** — DELETE now has no policy at all and is fully default-deny for every role. This is intentional, not a coverage gap to fix later: no DELETE route, UI action, or any other application code deletes a quote anywhere in this codebase (confirmed by repo-wide grep), and the one foreign key referencing `quotes.id` (`invoices_quote_id_fkey`) is `ON DELETE NO ACTION`, so nothing cascades into a quote delete either. Adding a `quotes_tenant_delete` scoped policy now would mean designing a permission for a feature that doesn't exist — deferred to whenever a delete feature is actually built. As with `invoices` and `closed_deals`, the surviving policies' `OR tenant_id = <dev-fallback-tenant>` branch is an interim pre-auth-mapping scaffold, not the final production model — it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).

**Verification (2026-07-14, after approved live apply):**
- Before apply: `pg_policies` for `quotes` returned 7 policies (the 4 legacy + 3 scoped listed above).
- `apply_migration` returned success.
- After apply: `pg_policies` for `quotes` returns exactly 3 rows — the `quotes_tenant_*` (SELECT/INSERT/UPDATE) set, byte-for-byte unchanged. No DELETE policy of any kind remains. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/quotes.migration.test.js`): **5/5 passed** — anon INSERT succeeds for the dev-fallback tenant, anon INSERT with a nonexistent tenant is rejected, the dev-fallback-tenant row is visible via the scoped SELECT policy, anon UPDATE on a dev-fallback-tenant row succeeds, and anon DELETE is confirmed default-deny (the operation reports zero rows affected rather than an error, and the row remains present on a follow-up SELECT). Per the test file's own header, the mismatched-tenant INSERT rejection cannot be isolated to RLS alone versus the table's FK on `tenant_id` (only one tenant row exists in this project) — the same open work as cross-tenant SELECT isolation (Block 1.9). Because DELETE is default-deny by design, the test client cannot truly remove its own rows and instead best-effort marks them `status: 'expired'` via the retained scoped UPDATE policy — the same accepted trade-off documented in `tests/closedDeals.migration.test.js` for its own anon-cannot-DELETE table.
- Default skip-mode (`npx vitest run tests/quotes.migration.test.js`): 6/6 skipped, as intended outside manual/CI-gated runs.
- `tests/quotesController.test.js`: 18/18 passed.
- Full suite: `npm test` → 413 passed / 43 skipped / 0 failed.
- Policy counts on the other checked tables were re-checked and are unchanged: `smart_leads`=8, `call_logs`=3, `closed_deals`=2, `invoices`=4, `segments`=4, `smart_interactions`=6, `whatsapp_sessions`=1. Nothing else was touched.

**Block 1 status:** this closes Block 1.6b. The Section 7/10 SHOWSTOPPER is now reduced to 5 tables: `smart_leads`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Decision Brain implementation is not started.

---

## 16. Applied — `phase_1_7b_drop_smart_leads_permissive_policy`

**Status: APPLIED.** Applied 2026-07-16 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_7b_drop_smart_leads_permissive_policy.sql`. Committed draft-only in `70156c9`, applied only after a separate Command Room approval for this specific migration.

**Why:** `smart_leads`' blockers — the previously identified high-risk access paths with no explicit tenant filter (`db.js`'s phone lookup, `controllers/calls.js`'s lead select, `controllers/leadWebhook.js`'s `linkLeadContact` update, `server.js`'s WhatsApp `smart_leads` updates, four frontend pages, and `lib/autoReplySweeper.js`'s four query sites plus `engine.js`'s post-auto-reply-decision update) — were resolved first across Block 1.7a (`ab6b86f`) and Block 1.7a-2 (`5e5c3e3`). A follow-up read-only audit re-confirmed all of the above directly against current source and found only two remaining unscoped references, neither an operational blocker: `server.js`'s `/api/responder/dispatch` embed (read-only, internal-key-gated, not end-user reachable) and `lib/supabaseLeads.js`'s `insertLead()` (dead code, zero callers anywhere in the repo). A live `pg_policies` query confirmed `smart_leads` carried 4 legacy permissive policies alongside 4 already-correct tenant-scoped sibling policies — full CRUD scoped coverage already existed, unlike `quotes` (no scoped DELETE sibling).

**Soft-delete parity — why this migration also replaces a scoped policy, not just drops legacy ones:** unlike every other table in this family, this migration also replaces `smart_leads_tenant_select` (DROP + CREATE, since Postgres has no `ALTER POLICY ... USING`) rather than leaving it unchanged. The legacy `tenant_leads_select` was the only policy anywhere enforcing `deleted_at IS NULL` for `smart_leads` reads; the existing scoped SELECT policy didn't carry that clause. A repo-wide audit (2026-07-16) found 0 of 13 live rows soft-deleted and no code path anywhere writes `deleted_at` on `smart_leads` today — so this drop couldn't regress a live feature — but dropping the legacy policy outright would still have silently removed that invariant's only enforcement at the RLS layer, relying on the accident that no soft-delete feature exists yet rather than protecting against one being added later without anyone updating this policy. The replacement folds `AND deleted_at IS NULL` into the scoped SELECT policy permanently.

**What it removed / changed:**
- `tenant_leads_select` (SELECT, `USING deleted_at IS NULL`) — dropped
- `tenant_leads_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped
- `tenant_leads_update` (UPDATE, `USING true`) — dropped
- `tenant_leads_delete` (DELETE, `USING true`) — dropped
- `smart_leads_tenant_select` (SELECT) — **replaced**: now `USING ((tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>) AND deleted_at IS NULL)`
- `smart_leads_tenant_insert` (INSERT, same tenant condition) — kept, unchanged
- `smart_leads_tenant_update` (UPDATE, same tenant condition) — kept, unchanged
- `smart_leads_tenant_delete` (DELETE, same tenant condition) — kept, unchanged

**Result:** `smart_leads` keeps a correct scoped policy for **all four commands** (SELECT/INSERT/UPDATE/DELETE) — full CRUD coverage retained, the same shape as `invoices`. As with `invoices`, `quotes`, and `closed_deals`, the surviving policies' `OR tenant_id = <dev-fallback-tenant>` branch is an interim pre-auth-mapping scaffold, not the final production model — it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).

**Diagnostic finding during verification — expected RLS/PostgREST interaction, not a migration defect:** the original gated migration test asserted anon could set `deleted_at` via UPDATE and then find the row excluded from its own SELECT. That failed live with `42501 — new row violates row-level security policy`. A direct anon-client diagnostic (reproduced independently, with and without `.select()` chained on the UPDATE — identical failure either way, and confirmed the failed UPDATE did not partially apply, `deleted_at` stayed null) established the cause: PostgREST always executes UPDATE with an internal `RETURNING` clause regardless of client-side `.select()`, and Postgres RLS requires the RETURNING row to satisfy the table's SELECT policy. `smart_leads_tenant_update` has no explicit `WITH CHECK` (falls back to its tenant-only `USING` clause), so nothing about the UPDATE policy itself stops `deleted_at` from being set — but the resulting row no longer satisfies the now-stricter SELECT policy, so Postgres rejects the whole statement rather than silently succeeding. No app code path anywhere soft-deletes `smart_leads`, so anon self-service soft-delete was never an actual requirement to prove. Test patched (`86b27db`) to assert the real contract instead: anon cannot set `deleted_at` directly (`error.code === '42501'`, confirmed no partial application), plus a separate `SUPABASE_SERVICE_ROLE_KEY`-gated block (skipped in this environment — no service-role key is configured in `.env.local`, by design) that seeds a soft-deleted row via a privileged client and confirms anon's SELECT excludes it, proving the actual policy invariant without relying on anon performing the visibility-losing transition itself.

**Verification (2026-07-16, after approved live apply):**
- Before apply: `pg_policies` for `smart_leads` returned 8 policies (the 4 legacy + 4 scoped listed above).
- `apply_migration` returned success.
- After apply: `pg_policies` for `smart_leads` returns exactly 4 rows — `smart_leads_tenant_select/_insert/_update/_delete`. `smart_leads_tenant_select`'s live `qual` confirmed to include both the tenant condition and `deleted_at IS NULL`; the other three scoped policies confirmed byte-for-byte unchanged. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/smartLeads.migration.test.js`): initial run was 5 passed / 1 failed (the soft-delete-parity assertion — see diagnostic finding above). Post-patch (`86b27db`): **6 passed, 2 skipped, 0 failed** — the 2 skipped are the service-role-gated invariant test and its skip-guard stub, expected in this environment.
- Targeted related tests (`tests/autoReplySweeper.test.js`, `tests/engine.failedIngestions.test.js`, `tests/db.test.js`, `tests/leadWebhook.test.js`): 48/48 passed.
- Full suite: `npx vitest run` → 413 passed / 51 skipped / 0 failed.
- Policy counts on the other checked tables were re-checked and are unchanged: `call_logs`=3, `closed_deals`=2, `invoices`=4, `quotes`=3, `segments`=4, `smart_interactions`=6, `whatsapp_sessions`=1, `email_threads`=0. Nothing else was touched. Inventory Engine and Decision Brain tables/code were not touched by this migration or its verification.

**Block 1 status:** this closes Block 1.7b. The Section 7/10 SHOWSTOPPER is now reduced to 4 tables: `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Decision Brain implementation is not started.

---

## 17. Applied — `phase_1_8_drop_call_logs_permissive_policy`

**Status: APPLIED.** Applied 2026-07-16 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_8_drop_call_logs_permissive_policy.sql`. Committed draft-only in `414ec6b`, applied only after a separate Command Room approval for this specific migration.

**Why:** the Block 1.8 planning audit (2026-07-16) found `call_logs` had 0 live rows, `tenant_id` NOT NULL at the schema level, no `deleted_at` column (no soft-delete concept for this table), and exactly two real INSERT dependents — `controllers/calls.js`'s `POST /api/calls` (behind `requireInternalKey`, zero callers anywhere in the repo today) and `frontend/src/app/app/leads/[id]/page.tsx`'s live "Log Call" modal — both already stamping `tenant_id` correctly, so no app-code hygiene block was needed first (unlike `smart_leads`' Block 1.7a/1.7a-2). Zero SELECT, UPDATE, or DELETE app dependents exist anywhere in the codebase.

**Not like any prior table in this family — `call_logs` had zero scoped sibling policies of any kind before this migration.** Every table closed so far had at least partial scoped coverage to fall back on when its legacy policies were dropped (`quotes`/`closed_deals` partial, `invoices`/`smart_leads` full). `call_logs` had none — only 3 legacy-shaped policies (`tenant_call_logs_select`, `tenant_call_logs_insert`, `tenant_call_logs_update`) and no DELETE policy at all (already default-deny before this migration touched anything). Dropping the legacy INSERT policy with no replacement would have broken both real INSERT dependents immediately, so this migration **adds** a new scoped `call_logs_tenant_insert` policy — the only command with an app dependent — rather than only dropping legacy ones, the first migration in this family to do so from a zero-scoped-policy starting point.

**What it added / removed:**
- `call_logs_tenant_insert` (INSERT) — **added**: `WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)`
- `tenant_call_logs_select` (SELECT, `USING true`) — dropped, **no scoped replacement**
- `tenant_call_logs_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped, replaced by the new scoped policy above
- `tenant_call_logs_update` (UPDATE, `USING true`) — dropped, **no scoped replacement**

**Result:** `call_logs` keeps exactly one policy — scoped INSERT. SELECT and UPDATE are now fully default-deny by design: zero app code anywhere reads or updates `call_logs` (confirmed by repo-wide grep, including `tests/`), so adding scoped policies for those commands would mean designing permissions for features that don't exist — the same reasoning already applied to `quotes`' DELETE (Block 1.6b) and `closed_deals`' UPDATE/DELETE (Block 1.4c). DELETE remains default-deny, unchanged by this migration (it already had no policy before). As with every other surviving-policy table in this family, the new scoped policy's `OR tenant_id = <dev-fallback-tenant>` branch is an interim pre-auth-mapping scaffold, not the final production model — it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).

**Verification (2026-07-16, after approved live apply):**
- Before apply: `pg_policies` for `call_logs` returned 3 policies (the 3 legacy listed above), RLS enabled, 0 rows.
- `apply_migration` returned success.
- After apply: `pg_policies` for `call_logs` returns exactly 1 row — `call_logs_tenant_insert`, INSERT only, `with_check` confirmed to match the expected tenant condition exactly. No SELECT, UPDATE, or DELETE policy of any kind. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/callLogs.migration.test.js`): **2 passed, 0 failed** — anon INSERT for the dev-fallback tenant still succeeds; anon INSERT with a nonexistent tenant is rejected (FK-vs-RLS caveat, same as every sibling test in this family); anon SELECT on the inserted row returns `[]`; anon UPDATE and anon DELETE both affect 0 rows with no error — all three default-deny outcomes confirmed empirically, not just inferred from policy absence.
- Cleanup: no `SUPABASE_SERVICE_ROLE_KEY` is configured in `.env.local`, so the test's own cleanup path was a documented no-op, leaving one row marked `__integration_test__call_logs_contract__...` in `notes`. Cleaned up via the privileged Supabase MCP SQL path (confirmed the single marked row, including that its `outcome` was still unchanged from insert — independent confirmation the UPDATE attempt truly had zero effect — then deleted it). Verified afterward: 0 rows remain matching that marker prefix, and `call_logs`' total row count is back to 0 — identical to its pre-test state.
- No targeted app tests exist for `call_logs`/`logCall`/the leads detail page beyond the migration test itself (confirmed by repo-wide grep of `tests/`).
- Full suite: `npx vitest run` → 413 passed / 54 skipped / 0 failed.
- Policy counts on the other checked tables were re-checked and are unchanged: `closed_deals`=2, `invoices`=4, `quotes`=3, `segments`=4, `smart_interactions`=6, `smart_leads`=4, `whatsapp_sessions`=1, `email_threads`=0. Nothing else was touched. Inventory Engine and Decision Brain tables/code were not touched by this migration or its verification.

**Block 1 status:** this closes Block 1.8. The Section 7/10 SHOWSTOPPER is now reduced to 3 tables: `segments`, `smart_interactions`, `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Decision Brain implementation is not started.

---

## 18. Applied — `phase_1_9_drop_segments_permissive_policy`

**Status: APPLIED.** Applied 2026-07-17 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_9_drop_segments_permissive_policy.sql`. Committed draft-only in `a61a73c`, applied only after a separate Command Room approval for this specific migration.

**Why:** the Block 1.9 planning audit (2026-07-17) found `segments` had 0 live rows, `tenant_id` NOT NULL at the schema level, no `deleted_at` column (no soft-delete concept for this table), and zero backend controller access — every dependent is a raw frontend anon Supabase client (no JWT), unlike `call_logs` (one backend path). Three commands have live, end-user-reachable dependents: SELECT (`frontend/src/app/app/segments/page.tsx`'s list view, plus its `segments-watch` Realtime `postgres_changes` subscription, which is also gated by the SELECT policy — Realtime does not bypass RLS), INSERT (`frontend/src/app/app/segments/new/page.tsx`'s "Save Segment" form, stamping `tenant_id` correctly), and UPDATE (`page.tsx`'s "Run Campaign" button, setting `last_run_at`). The UPDATE call filters only by `.eq("id", segment.id)` — it does not filter by tenant_id in the app-level query — so the scoped UPDATE policy's `USING` clause is the *sole* tenant boundary on that call path, not an app-level WHERE clause. DELETE has zero app dependents anywhere (confirmed by repo-wide grep, including `tests/`).

**Like `call_logs` (Block 1.8), but harder — `segments` had zero scoped sibling policies of any kind before this migration.** `call_logs` had only one command (INSERT) with a real app dependent, so only one scoped policy needed adding. `segments` needed three — SELECT, INSERT, and UPDATE all required new scoped policies before their legacy counterparts could be dropped, or all three live frontend flows would have broken immediately.

**What it added / removed:**
- `segments_tenant_select` (SELECT) — **added**: `USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)`
- `segments_tenant_insert` (INSERT) — **added**: same tenant condition, as `WITH CHECK`
- `segments_tenant_update` (UPDATE) — **added**: same tenant condition, as `USING`
- `tenant_segments_select` (SELECT, `USING true`) — dropped, replaced by the new scoped policy above
- `tenant_segments_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped, replaced by the new scoped policy above
- `tenant_segments_update` (UPDATE, `USING true`) — dropped, replaced by the new scoped policy above
- `tenant_segments_delete` (DELETE, `USING true`) — dropped, **no scoped replacement**

**Result:** `segments` now keeps exactly three policies — scoped SELECT/INSERT/UPDATE. Policy count went from 4 to 3. DELETE is now fully default-deny by design: zero app code anywhere deletes a segment (confirmed by repo-wide grep, including `tests/`), the same reasoning already applied to `quotes`' DELETE (Block 1.6b) and `closed_deals`' UPDATE/DELETE (Block 1.4c). As with every other surviving-policy table in this family, the new scoped policies' `OR tenant_id = <dev-fallback-tenant>` branch is an interim pre-auth-mapping scaffold, not the final production model — it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).

**Out of scope — `segment_runs`:** the adjacent table written by the same "Run Campaign" flow carries an identical zero-scoped-policy pattern (`tenant_segment_runs_select` USING true, `tenant_segment_runs_insert` WITH CHECK tenant_id IS NOT NULL, no UPDATE/DELETE policy). It is not one of the SHOWSTOPPER tables and this migration does not touch it — left for its own future block.

**Verification (2026-07-17, after approved live apply):**
- Before apply: `pg_policies` for `segments` returned 4 policies (the 4 legacy listed above), RLS enabled (not forced), 0 rows.
- `apply_migration` returned success.
- After apply: `pg_policies` for `segments` returns exactly 3 rows — `segments_tenant_select`/`_insert`/`_update`, each single-command, `qual`/`with_check` confirmed to match the expected tenant condition exactly. No DELETE policy of any kind. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/segments.migration.test.js`): **2 passed, 0 failed** — anon INSERT for the dev-fallback tenant succeeds; anon SELECT sees the inserted row via the scoped policy; anon UPDATE succeeds filtering only by `id` (matching the real frontend Run Campaign call shape); anon DELETE affects 0 rows with no error, and the row remains visible afterward — default-deny confirmed empirically; anon INSERT with a nonexistent tenant is rejected (FK-vs-RLS caveat, same as every sibling test in this family).
- Cleanup: no `SUPABASE_SERVICE_ROLE_KEY` is configured in `.env.local`, so the test's own cleanup path was a documented no-op, leaving one row marked `__integration_test__segments_contract__...` in `name`. Cleaned up via the privileged Supabase MCP SQL path (confirmed the single marked row, including that its `last_run_at` was populated — independent confirmation the UPDATE attempt truly succeeded — then deleted it). Verified afterward: `segments`' total row count is back to 0 — identical to its pre-test state.
- `tests/segments.test.js` (pure `segment-utils.ts` helpers, unaffected by this migration): 13/13 passed.
- Full suite: `npx vitest run` → 413 passed / 57 skipped / 0 failed, 32 files passed / 10 skipped.
- Policy counts on the other checked tables were re-checked and are unchanged: `call_logs`=1, `closed_deals`=2, `invoices`=4, `quotes`=3, `smart_interactions`=6, `smart_leads`=4, `whatsapp_sessions`=1, `email_threads`=0. `segment_runs` was not touched. Inventory Engine and Decision Brain tables/code were not touched by this migration or its verification.

**Block 1 status:** this closes Block 1.9. The Section 7/10 SHOWSTOPPER is now reduced to 2 tables: `smart_interactions` and `whatsapp_sessions` remain effectively not tenant-isolated and still block real production traffic. Decision Brain implementation is not started.

---

## 19. Applied — `phase_1_10b_drop_smart_interactions_permissive_policy`

**Status: APPLIED.** Applied 2026-07-18 to live Supabase project `lmslyfxvvnvjojsymehy`. Full migration file: `supabase/migrations/phase_1_10b_drop_smart_interactions_permissive_policy.sql`. Committed draft-only in `0153fdd`, applied only after a separate Command Room approval for this specific migration.

**Why `smart_interactions` was high risk:** with 18 live rows and the fastest projected growth of any table in this schema (Section 4's "hidden hotspot" observation — up to 100+ interactions per lead at scale), `smart_interactions` backs the entire human-in-the-loop drafts workflow: every AI-generated reply, its approval/edit/dismiss/escalate lifecycle, and the outbound dispatch record all live in this one table. Before this migration it carried two overlapping RLS policy sets — a correctly tenant-scoped SELECT/INSERT pair alongside four legacy permissive policies (`USING true` on SELECT/UPDATE/DELETE, a bare `tenant_id IS NOT NULL` check on INSERT) — and Postgres ORs multiple permissive policies together, so the permissive set won regardless of the scoped policies' existence. In practice this meant any anon client could read, update, or delete any tenant's draft messages.

**Prerequisite — Block 1.10a dispatch hotfix (commit `4e01380`, already merged before this migration was drafted):** closed a separate hole in the same request path first — the frontend drafts page's "Approve" action now sends an `Authorization` header to `/api/dispatch`, the frontend proxy now rejects requests missing it, the backend `/api/responder/dispatch` route now requires auth (`requireAuth`) and a resolved `req.tenantId`, and its `smart_interactions` SELECT and both UPDATE statements are now explicitly scoped by `req.tenantId` at the app-code level. That hotfix fixed one server-side access path; this migration fixes the underlying database-level permissive-policy hole that let ANY tenant read/write/delete this table regardless of app code.

**Policy transition — 6 → 3, a different shape from the rest of this family:** unlike `call_logs` and `segments` (Blocks 1.8/1.9, both zero-scoped-policy starting points), `smart_interactions` already had correct scoped siblings for two of four commands before this migration:

- `interactions_tenant_select` (SELECT) — kept, unchanged.
- `interactions_tenant_insert` (INSERT) — kept, unchanged.
- `smart_interactions_tenant_update` (UPDATE) — **added**: `USING (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) WITH CHECK (tenant_id = auth_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)`.
- `tenant_interactions_select` (SELECT, `USING true`) — dropped, replaced by the already-existing scoped policy above.
- `tenant_interactions_insert` (INSERT, `WITH CHECK tenant_id IS NOT NULL`) — dropped, replaced by the already-existing scoped policy above.
- `tenant_interactions_update` (UPDATE, `USING true`) — dropped, replaced by the new scoped policy above.
- `tenant_interactions_delete` (DELETE, `USING true`) — dropped, **no scoped replacement**.

**Scoped UPDATE added with an explicit `WITH CHECK`, not left to Postgres' implicit fallback:** every other scoped UPDATE policy in this migration family (`segments_tenant_update`, `smart_leads_tenant_update`, `quotes_tenant_update`) relies on Postgres reusing `USING` as `WITH CHECK` when none is specified. `smart_interactions.tenant_id` is nullable at the schema level — unlike its NOT NULL siblings in this family — and this table's three live UPDATE dependents (`frontend/src/app/app/drafts/page.tsx`'s `handleDismiss`, `handleEscalate`, and `handleSaveAndSend`) are raw anon-client calls with no app-level tenant filter of any kind, filtering only by `.eq('id', draft.id)`. That makes this policy's `WITH CHECK` the *sole* backstop against one of those calls setting `tenant_id` to NULL or to a different tenant — written out explicitly rather than left implicit, and empirically confirmed by a dedicated tenant-id escape-hatch assertion in the companion test (below).

**DELETE default-deny — same reasoning as `quotes`/`closed_deals`/`segments`, but with one added wrinkle:** a repo-wide grep found zero production/application code that deletes a `smart_interactions` row anywhere in this codebase. The one known DELETE usage anywhere in the repo is NOT application code — it's gated integration-test cleanup: `tests/autoReplySweeper.migration.test.js`'s `afterEach` (Block 0.3, `RUN_DB_INTEGRATION_TESTS=true` only) deletes its own `smart_interactions` rows before deleting their parent `smart_leads` rows, relying on the now-dropped permissive `tenant_interactions_delete`. That gated test's cleanup will need service-role/MCP-privileged cleanup or explicit residual-row handling going forward — a known follow-up, not fixed by this migration (see caveats below). `tenant_interactions_delete` is dropped with no scoped replacement; DELETE is fully default-deny by design.

**Verification (2026-07-18, after approved live apply):**
- Before apply: `pg_policies` for `smart_interactions` returned 6 policies (the 2 scoped + 4 legacy listed above); RLS enabled, not forced; 18 rows, all on the dev-fallback tenant, 0 null `tenant_id`. Unrelated policy counts confirmed as a baseline: `call_logs`=1, `closed_deals`=2, `invoices`=4, `quotes`=3, `segments`=3, `smart_leads`=4, `whatsapp_sessions`=1, `email_threads`=0.
- `apply_migration` returned success.
- After apply: `pg_policies` for `smart_interactions` returns exactly 3 rows — `interactions_tenant_select`/`_insert` byte-for-byte unchanged, `smart_interactions_tenant_update` confirmed `FOR UPDATE` with both `qual` and `with_check` matching the expected tenant condition exactly. No DELETE policy of any kind. `pg_class.relrowsecurity = true`, `relforcerowsecurity = false` — RLS remains enabled. Row count unchanged at 18. All 8 unrelated tables' policy counts re-checked and unchanged from baseline.
- Gated integration test (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/smartInteractions.migration.test.js`): **2 passed, 0 failed** — anon INSERT/SELECT/UPDATE all succeed for the dev-fallback tenant (UPDATE tested filtering only by `id`, matching the real frontend Dismiss/Escalate/Save-and-Send call shape); a dedicated tenant-id escape-hatch assertion confirmed the row's `tenant_id` stays on the dev-fallback tenant after attempting to set it to `NULL` and to a nonexistent tenant, proving the new explicit `WITH CHECK` actually holds; anon DELETE is empirically default-deny (no error, zero rows affected, row still visible); anon INSERT with a nonexistent tenant is rejected (FK-vs-RLS caveat, same as every sibling test in this family).
- Cleanup: no `SUPABASE_SERVICE_ROLE_KEY` is configured in `.env.local`, so the test's own cleanup path was a documented no-op, leaving one marked row pair (`__integration_test__smart_interactions_contract__...` in `smart_interactions.message_content`, and its parent `smart_leads` row via `lead_channel_id`). Cleaned up via the privileged Supabase MCP SQL path — inspected both marked rows first, then deleted the child `smart_interactions` row before the parent `smart_leads` row (no `ON DELETE CASCADE` on that FK). Verified afterward: 0 residual rows matching the marker in either table; `smart_interactions` back to 18 rows, `smart_leads` back to 13 rows — both identical to their pre-test state.
- Default skip-mode runs (`npx vitest run tests/smartInteractions.migration.test.js` and `npx vitest run tests/autoReplySweeper.migration.test.js`): both clean, all tests skipped as intended.
- Full suite: `npx vitest run` → **413 passed / 60 skipped / 0 failed**, 32 files passed / 11 skipped — no regressions (the skip count is up exactly 3, matching this new test file's default-skip tests).

**Remaining caveats — not fixed by this migration:**
- The `OR tenant_id = <dev-fallback-tenant>` branch on every surviving policy (including the new `smart_interactions_tenant_update`) is still an interim pre-auth-mapping scaffold, not the final production model — Block 1's `auth.uid() → tenant_id` mapping is still not implemented anywhere in this codebase, and it does not yet prove per-tenant isolation between two distinct *authenticated* tenants (only one tenant row exists in this project today).
- `frontend/src/app/app/drafts/page.tsx`'s list SELECT, its `drafts-watch` Realtime `postgres_changes` subscription, and its Dismiss/Escalate/Save-and-Send UPDATEs are still raw browser anon-client calls with no JWT, relying on RLS alone — this migration only removes the database-level permissive-policy hole underneath them, it does not touch that Lane C architecture.
- `server.js`'s dispatch route updates `ai_learning` by `interaction_id` only, with no `tenant_id` filter of its own — unchanged, remains a follow-up.
- `server.js`'s dispatch route's `lead_activities` insert still uses the `DEFAULT_TENANT_ID` fallback constant, not `req.tenantId` — unchanged, remains a follow-up.
- `tests/autoReplySweeper.migration.test.js`'s gated `afterEach` cleanup still assumes anon can DELETE `smart_interactions` rows directly — that assumption no longer holds post-migration (see the DELETE rationale above); it was not patched as part of this apply step per explicit scope constraints, and remains a known follow-up for whenever that gated test is next run.
- `whatsapp_sessions` remains the final SHOWSTOPPER table — the only one of the original 9 still carrying legacy permissive policies alongside (or instead of) tenant-scoped ones.

**Block 1 status:** this closes Block 1.10b. The Section 7/10 SHOWSTOPPER is now reduced to 1 table: `whatsapp_sessions` remains effectively not tenant-isolated and still blocks real production traffic. Decision Brain implementation is not started. Inventory Engine untouched.
