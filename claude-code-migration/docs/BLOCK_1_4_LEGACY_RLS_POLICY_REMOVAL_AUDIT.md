> Copied verbatim from Claude Code plan-mode storage
> (`~/.claude/plans/we-are-continuing-invisible-iridescent-stardust.md`) into repo docs as a
> docs-only audit record, per Command Room approval. Content below is unchanged from the
> original planning audit. Command Room verdict (2026-07-10): Block 1.4a (this audit) approved
> as planning complete; Block 1.4b (the proposed `email_threads` policy drop) not yet
> implemented — no migration, RLS change, or code change has been made.

# Block 1.4 — Legacy Permissive RLS Policy Removal: Planning Audit

## Context

Block 0 closed with a documented pre-launch SHOWSTOPPER in `DB_AUDIT_REPORT.md` §7/§10: nine tenant-scoped tables carry **two overlapping RLS policy sets** — a newer, correctly tenant-scoped set and an older permissive set (`qual = true` or no tenant check at all). Because Postgres OR's all applicable permissive policies together, the permissive set wins regardless of which is newer — these tables are effectively not tenant-isolated today, independently confirmed by Supabase's own `rls_policy_always_true` advisor. Block 1.1 (Lane A user-facing routes → `req.supabase`) and Block 1.3b (`tenant_id` threaded through `db.js`) have each closed part of the gap, but neither touched the RLS policies themselves. This audit (Block 1.4) is the planning-only step to determine whether and how those legacy permissive policies can now be safely dropped, without a fresh set of eyes assuming the codebase looks like the two-lane (Lane A / Lane B) model described in prior docs — investigation surfaced a third, previously undocumented lane that materially changes the risk picture. **This document is planning only — no migration, RLS edit, or code change is made here.**

---

## 1. Executive summary

- **Overall risk level: HIGH** — matches DB_AUDIT_REPORT's own SHOWSTOPPER framing, and is arguably worse than previously scoped: the exposure is not limited to internal misuse, since `NEXT_PUBLIC_SUPABASE_ANON_KEY` is embedded client-side and readable by anyone, meaning the permissive policies are exploitable via direct PostgREST calls regardless of whether the app's own UI ever exercises a given table.
- **Can Block 1.4 safely proceed now as a full removal? No.** A blanket drop of the permissive policies would break the majority of the system's live write/read paths today (see §3–§5). Only a narrow slice is safe right now.
- **What must be fixed first (blocking a broad removal):**
  1. A previously undocumented **"Lane C"** — seven Next.js frontend pages querying Supabase directly with a bare anon-key client (no JWT, no cookies) and a hardcoded tenant UUID — has no auth context at all and depends entirely on the permissive policies (or an equivalent anon-role grant) to function. This needs its own triage decision from Command Room before any of the tables it touches can be tightened.
  2. Lane B (`engine.js`/`db.js`, webhooks, cron jobs, `/api/responder/dispatch`, `/api/draft-action`) never carries a user JWT, so `auth.uid()`-based tenant-scoped policies will always reject it once the permissive fallback is gone — this is exactly the gap Block 1.3's deferred RPC work (1.3c/1.3d) was designed to close.
  3. Two Lane A routes (`controllers/billing.js`, `controllers/auth.js`) are wired with `requireAuth` but use the shared anon-key client instead of `req.supabase` — they look migrated but aren't; this needs a small fix before `invoices` can be tightened.
- **Will migration approval be required?** Yes — any actual `DROP POLICY`/`CREATE POLICY` change needs Command Room sign-off and a `DB_AUDIT_REPORT.md` entry, per existing project convention. Nothing in this document authorizes that step.

---

## 2. Current permissive policy inventory

Note: the `supabase/migrations/` folder is **not** the source of truth — it holds only 3 files, and only one (`failed_ingestions`) contains a verbatim, committed `CREATE POLICY`. Everything else below is reconstructed from `DB_AUDIT_REPORT.md` and `claude-code-migration/docs/BLOCK_1_3_LANE_B_SYSTEM_ACTOR_AUDIT.md` prose, which quote policy names and `qual`/`with check` summaries but not full SQL for most tables. **Live confirmation via `pg_policies` is a prerequisite before any migration is written** (see §10, Q4).

| Table | Policy (legacy) | Command | Role | USING | WITH CHECK | Why unsafe | Currently needed by | Recommended action |
|---|---|---|---|---|---|---|---|---|
| `smart_leads` | `tenant_leads_select` / `_insert` / `_update` (legacy half) | SELECT/INSERT/UPDATE/DELETE | anon, authenticated | `deleted_at IS NULL` (select); none stated (update/delete) | `true` (update); `tenant_id IS NOT NULL` (insert, no ownership check) | No tenant predicate on select/update/delete; insert accepts any non-null tenant_id | Lane B (`db.js`, all webhooks), Lane C (`dashboard`, `leads`, `leads/[id]` pages) | Replace, not drop — blocked on Lane B/C fix |
| `smart_interactions` | `tenant_interactions_*` (legacy half) | ALL | anon, authenticated | same pattern as above | same pattern | Same as above | Lane B (`db.js`, dispatch route, calls controller) | Replace, blocked |
| `lead_activities` | legacy catch-all (name unconfirmed) | SELECT/INSERT/UPDATE | anon, authenticated | unconfirmed | `tenant_id IS NOT NULL` (insert) | No confirmed auth-scoped sibling exists (unlike smart_leads) — needs live check | Lane B (dispatch route, digest, calls controller), Lane C (`leads/[id]`) | Needs live confirmation before any action |
| `closed_deals` | legacy catch-all | SELECT/INSERT/UPDATE | public | unconfirmed | `true` | **No `tenant_id` column exists at all** — cannot be tenant-scoped without a schema change | None — zero application code references this table | Unsafe to touch; blocked on schema (Block 1.5) |
| `invoices` | `tenant_invoices_all` / `tenant_invoices_select` | ALL / SELECT | public | `true` | `true` | DB_AUDIT_REPORT explicitly states tenant isolation "still not enforced" here — **no confirmed auth-scoped sibling exists** | Lane A (`/api/invoices*`, fixed) **+** `controllers/billing.js` (anon client despite `requireAuth`) | Replace — but first fix billing.js to use `req.supabase` |
| `quotes` | `anon_all_quotes` (legacy) | ALL | anon, authenticated | `true` | `true` | No confirmed auth-scoped sibling; Lane C's `quotes/page.tsx` list query has **no tenant filter of any kind**, relies solely on this policy | Lane C (`quotes`, `quotes/new` pages) | Unsafe to remove — Lane C fix is a hard prerequisite |
| `email_threads` | `anon_all_email_threads` (legacy) | ALL | anon, authenticated | `true` | `true` | No confirmed auth-scoped sibling | **None — zero application code references this table anywhere** (routes, controllers, or frontend) | **Safe drop candidate** (see §4) |
| `call_logs` | `anon_all_call_logs` (legacy) | SELECT/INSERT/UPDATE | anon, authenticated | unconfirmed | `tenant_id IS NOT NULL` | No confirmed auth-scoped sibling | Lane B (`controllers/calls.js`, `requireInternalKey` + anon client + `DEFAULT_TENANT_ID`), Lane C (`leads/[id]` insert) | Unsafe to remove yet |
| `segments` (+ `segment_runs`) | `anon_all_segments` / `anon_all_segment_runs` | ALL / SELECT+INSERT | anon, authenticated | `true` | `true` | No confirmed auth-scoped sibling | Lane C (`segments`, `segments/new` pages, hardcoded tenant, no JWT) | Unsafe to remove yet |
| `whatsapp_sessions` | `"Allow backend to manage sessions"` | ALL | public | unconfirmed, likely unconditional | unconfirmed | `tenant_id` column is **VARCHAR, not UUID** — separate structural defect complicating any exact-match predicate | `controllers/tenants.js` (`requireInternalKey`, anon client) | Unsafe to remove yet — structural fix needed first |

**Adjacent, out-of-primary-scope finding:** `tenants.authenticated_read_tenants` (SELECT, `{anon,authenticated}`, `qual: true`) makes tenant metadata anon-readable. Not tenant-scoped in the same sense (it's the root table), flagged in DB_AUDIT_REPORT §5 but not part of this table's requested scope — likely Block 1.7 territory (function/table-level leaks).

---

## 3. Dependency analysis

Investigation found **three lanes**, not two:

- **Lane A** — Express routes behind `requireAuth`, using `req.supabase` (per-request JWT client). Fully migrated for invoices, products, escalations, settings, team (Block 1.1a–f). **Exception:** `controllers/billing.js` and `controllers/auth.js` sit behind `requireAuth` but use the shared anon-key client instead of `req.supabase` — they read `invoices`/`smart_leads`/`tenants` with manual `.eq('tenant_id', TENANT_ID)` filters, not RLS-via-JWT.
- **Lane B** — `engine.js`/`db.js`, all webhooks (WhatsApp, email, generic form), cron jobs (`digestScheduler`, `autoReplySweeper`, `followUpEngine`), and system-actor routes (`/api/responder/dispatch`, `/api/draft-action`, `controllers/calls.js`, `controllers/tenants.js`, `controllers/digest.js`) — all use the single shared anon-key client (`lib/supabase.js`). **No service-role key exists anywhere in the Express backend.** Only `db.js`'s `smart_leads`/`smart_interactions` inserts carry a real `tenant_id` (Block 1.3b); everything else in Lane B still uses `DEFAULT_TENANT_ID` directly, or (for the sweeper) no tenant filter at all.
- **Lane C (new finding, not covered by any prior block)** — 7 Next.js pages (`dashboard`, `leads`, `leads/[id]`, `quotes`, `quotes/new`, `segments`, `segments/new`) instantiate their own raw anon-key `createClient` in the browser, with no JWT/cookie session, filtered by a hardcoded literal tenant UUID (`00000000-0000-0000-0000-000000000001`, matching `DEFAULT_TENANT_ID`). `quotes/page.tsx`'s list query has no tenant filter at all. These pages touch `smart_leads`, `quotes`, `segments`, `segment_runs`, `call_logs`, `lead_activities` directly, bypassing the Express backend and any auth middleware entirely.

For every one of the 9 named tables except `closed_deals` and `email_threads`, **at least one of Lane B or Lane C depends on anon-role broad access with zero `auth.uid()` context** — meaning a strict auth-scoped replacement policy (keyed on `auth_tenant_id()`) would reject these paths outright once the permissive fallback is removed. `auth.uid()` is NULL for both lanes by construction: Lane B has no user session (webhooks/crons aren't user-initiated), and Lane C never attaches a session token.

Neither Block 1.1 nor Block 1.3b removed this dependency for any of these 9 tables — 1.1 only touched Lane A route wiring, and 1.3b only added `tenant_id` to two `db.js` inserts, which doesn't change what RLS role/context those inserts run under.

---

## 4. Safe removal candidates

**`email_threads`** — genuinely safe to drop the permissive policy now:
- **Why safe:** zero application code (route, controller, lib, or frontend) references this table anywhere in the repo. No runtime path — Lane A, B, or C — depends on it.
- **Residual risk if left alone:** still exploitable via direct PostgREST calls using the public anon key, since RLS is the only gate and it currently allows anything.
- **Tests needed:** a `tests/emailThreads.migration.test.js` (gated, `RUN_DB_INTEGRATION_TESTS=true`) asserting anon SELECT/INSERT/UPDATE/DELETE are now rejected without a matching tenant context, mirroring the pattern in `tests/stockMovement.migration.test.js`.
- **Rollback:** since nothing depends on it, rollback is trivial — re-apply the dropped policy from a saved copy if any future feature needs anon access before a proper policy is designed.

No other table in the requested scope is a safe immediate-drop candidate — see §5.

---

## 5. Unsafe-to-remove-yet candidates

| Table | Blocker | Exact dependent code path | Proposed prerequisite | Which block should own it |
|---|---|---|---|---|
| `smart_leads`, `smart_interactions` | Lane B has no JWT; Lane C reads directly with hardcoded tenant, no JWT | `db.js#saveLeadAndLogToDatabase`, all webhook handlers, `dashboard`/`leads`/`leads/[id]` pages | Lane B RPC path (Block 1.3c/d) or an accepted narrowed dev-fallback policy design; Lane C triage decision | Block 1.3 (RPCs, deferred) + new Lane C block |
| `lead_activities` | Same as above, plus unconfirmed whether an auth-scoped sibling policy even exists | `/api/responder/dispatch`, `controllers/calls.js`, `controllers/digest.js`, `leads/[id]` page | Live `pg_policies` confirmation first; then same as above | Same |
| `closed_deals` | No `tenant_id` column — cannot be scoped regardless of policy design | None currently — but blocked structurally, not by traffic | Add `tenant_id UUID REFERENCES tenants(id)` + backfill (schema migration) | Block 1.5 (schema blockers) |
| `invoices` | Lane A is fixed, but `billing.js` bypasses `req.supabase`; no confirmed auth-scoped sibling policy exists yet | `controllers/billing.js#getCurrentBilling`, `#createCheckout` | Fix billing.js to use `req.supabase`; then design+apply the missing auth-scoped policy | Small Lane A fix (candidate "Block 1.1g") + Block 1.4b |
| `quotes` | Lane C's list query has zero tenant filtering of its own — relies entirely on this policy; no confirmed auth-scoped sibling | `quotes/page.tsx`, `quotes/new/page.tsx` | Lane C triage — either move these pages behind an authenticated backend API, or give them a real session-based client | New Lane C block |
| `call_logs` | Lane B (`calls.js`, `requireInternalKey`) and Lane C (`leads/[id]` insert) both depend on anon-role write access | `controllers/calls.js`, `leads/[id]/page.tsx` insert | Same as smart_leads row | Block 1.3 + Lane C block |
| `segments` | Lane C fully depends on anon-role read/write with hardcoded tenant | `segments/page.tsx`, `segments/new/page.tsx` | Lane C triage | New Lane C block |
| `whatsapp_sessions` | `tenant_id` is VARCHAR not UUID — structural blocker independent of policy design; also used by `controllers/tenants.js` | `controllers/tenants.js` | Column type migration (VARCHAR → UUID) first | Block 1.5 (schema blockers) |

---

## 6. Proposed Block 1.4 target scope

Recommend the **smallest safe scope**: this document (1.4a, audit-only, mirroring the 1.3a pattern) plus, as a distinct follow-on slice (1.4b, not this conversation), **only** dropping the permissive policy on `email_threads`. Everything else — the other 8 tables — must stay on the permissive policy until at least one of the two structural prerequisites lands (Lane B RPCs / accepted fallback design, and a Lane C triage decision). **Full removal across the 9-table set is unsafe today and should not be attempted in Block 1.4.** This is a strict, narrow scope — it deliberately does not fold in Block 1.5 (schema), 1.6 (new scoped policies broadly), 1.7 (function-level leaks), 1.8 (`DEFAULT_TENANT_ID` removal), or 1.9 (cross-tenant integration tests).

---

## 7. Migration strategy, if applicable (planning only — not executed here)

- **Scope:** a single migration file, `phase_1_4b_drop_email_threads_permissive_policy.sql`, touching only `email_threads`.
- **Shape:** `DROP POLICY IF EXISTS "anon_all_email_threads" ON email_threads;` (exact name to be confirmed live first). No replacement policy created in the same migration, since no feature currently needs anon access to this table — a properly tenant-scoped policy should be added later, together with whatever feature first uses the table, not speculatively now.
- **Order:** single-statement drop; no ordering concerns since no other policy or table depends on it.
- **Transaction/rollback:** wrap in a transaction; rollback is simply re-creating the dropped policy from the migration file's own "before" comment block (same pattern used in `phase2_sweeper_claim_lock.sql`).
- **DB_AUDIT_REPORT logging:** required — append a dated entry following the existing §6/§8–10 format, including the live `pg_policies` before/after diff and confirmation that no test regressed.

No migration shape is proposed for the other 8 tables in this document — that work is blocked pending the prerequisites in §5 and would need its own planning pass once those land.

---

## 8. Test plan

- **Existing unit tests to run (no DB):** `npm test` — full mocked vitest suite, particularly `tests/auth.test.js`, `tests/db.test.js` (Block 1.3b pin), `tests/leadWebhook.test.js`, `tests/team.test.js`, `tests/invoices.test.js`, `tests/settings.test.js`, `tests/escalation.test.js`, `tests/billing.test.js`, `tests/segments.test.js`.
- **Gated DB integration tests to run before/after any 1.4b change:** `RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/failedIngestions.migration.test.js tests/stockMovement.migration.test.js tests/autoReplySweeper.migration.test.js` — confirm none regress from an unrelated `email_threads` policy drop (they shouldn't, but these are the only existing gated tests and should be run as a smoke check).
- **New tests needed before the 1.4b migration:** `tests/emailThreads.migration.test.js` (gated) proving anon SELECT/INSERT/UPDATE/DELETE are rejected post-drop with no regression for any legitimate path (there is none today).
- **Cross-tenant tests deferred to Block 1.9:** any test that would need ≥2 real tenants to prove isolation on the other 8 tables — cannot be written meaningfully until a second tenant exists, per Block 1.2b's own conclusion.
- **Manual verification:** after 1.4b (if approved), manually confirm via the Supabase dashboard/advisor that `email_threads` no longer shows `rls_policy_always_true`, and that no application page (there are none) errors.

---

## 9. What must be deferred

- Block 1.3 RPCs (`create_inbound_lead`, `record_dispatch_result`, etc.) — deferred per 1.3a's own recommendation, until a second tenant/channel exists or Lane B's anon-role dependency becomes actively exploited.
- Block 1.5 schema blockers (`closed_deals.tenant_id`, `whatsapp_sessions.tenant_id` VARCHAR→UUID) — required before those two tables can be touched at all.
- Block 1.6 new scoped policies (broad replacement policy design for the other 8 tables) — distinct from 1.4's narrow drop-only scope.
- Block 1.7 function-level leaks (`get_tenant_members`, `get_user_id_by_email` SECURITY DEFINER review, `tenants` anon-read policy).
- Block 1.8 `DEFAULT_TENANT_ID` removal — not touched; still load-bearing for single-tenant operation across Lane B and Lane C.
- Block 1.9 consolidated cross-tenant integration tests — needs ≥2 real tenants.
- Decision Brain — untouched.
- **New, not previously enumerated:** the Lane C frontend-direct-anon-key pattern needs its own remediation decision from Command Room — it doesn't cleanly fit inside Block 1.4's RLS-policy scope, since the real fix is architectural (route these pages through an authenticated backend API, or give the frontend a proper session-based client) rather than a policy change.

---

## 10. Open questions for Command Room

1. **Lane C** (7 frontend pages: `dashboard`, `leads`, `leads/[id]`, `quotes`, `quotes/new`, `segments`, `segments/new` — raw anon-key client, no JWT, hardcoded tenant UUID) was not previously documented in Block 1.1/1.2/1.3. Is this a known, accepted interim pattern, or a gap that needs its own block? This blocks tightening `smart_leads`, `quotes`, `segments`, `call_logs`, `lead_activities`.
2. `controllers/billing.js` and `controllers/auth.js` are wired with `requireAuth` but never use `req.supabase` — should this be fixed now as a small standalone slice (candidate "Block 1.1g") ahead of touching `invoices`' policy?
3. Is a narrowed "dev-fallback" policy (`tenant_id = auth_tenant_id() OR tenant_id = <single known default tenant>`) an acceptable interim replacement for the 8 blocked tables while Lane B RPCs are pending — narrowing blast radius from "any tenant" to "only the one known tenant" — or should Command Room wait for full RPC work before touching any of them?
4. The committed migrations don't contain the actual policy SQL for 8 of these 9 tables — do you want a live, read-only `pg_policies`/advisor confirmation run as the first step of 1.4b, before that migration is drafted?
5. `closed_deals` has zero live application usage — keep the table (and schedule the `tenant_id` addition under Block 1.5), or consider dropping/archiving it instead?

---

## 11. Recommendation

**Do a narrow, no-broad-migration slice next, not a full Block 1.4 removal.** Specifically: (a) accept this audit as Block 1.4a (docs-only, as with 1.3a), (b) queue a tightly-scoped Block 1.4b limited to dropping `email_threads`' permissive policy only, pending live `pg_policies` confirmation, (c) do not touch the other 8 tables until Command Room resolves the Lane C question and either accepts a narrowed dev-fallback design or greenlights the deferred Block 1.3 RPC work. Forcing a broader policy removal now would break live lead ingestion, the auto-reply/follow-up/digest pipelines, and all 7 Lane C frontend pages.
