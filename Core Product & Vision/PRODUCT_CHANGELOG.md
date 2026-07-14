# Invisible Sales OS — Product & Spec Changelog

_Tracks how the product spec itself has changed over time and why — the process, not the current state. For the current state, read `product.md` (what) and `architecture.md` (how). Reverse chronological — newest first._

---

## 2026-07-14 — Block 1.5b: `invoices` legacy permissive RLS policies dropped

**What changed:** Applied migration `phase_1_5b_drop_invoices_permissive_policy` (draft committed `b05bf29`) — removed the four legacy permissive RLS policies on `invoices` (`tenant_invoices_select`, `tenant_invoices_insert`, `tenant_invoices_update`, `tenant_invoices_delete`). No replacement policy was created; the existing scoped siblings (`invoices_tenant_select`, `invoices_tenant_insert`, `invoices_tenant_update`, `invoices_tenant_delete`) were left untouched. Unlike prior drops, `invoices` had a correct scoped sibling for all four commands, so full CRUD coverage is retained — the scoped policies still run on the interim dev-fallback-tenant policy branch (`tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>`), not the final `auth.uid()`-based production tenant mapping.

**Result:** `invoices` now keeps only the four scoped `invoices_tenant_*` policies; cross-tenant access is denied at the database layer instead of relying solely on app-layer `.eq('tenant_id', ...)` filtering.

**Verification:** apply succeeded; `pg_policies` for `invoices` returned exactly 4 policies after apply (the scoped set, unchanged); the gated `tests/invoices.migration.test.js` suite passed 5/5 against live Postgres, default skip-mode run passed 6/6 skipped, `tests/billing.test.js` passed 26/26, full suite `npm test` passed 395/37 skipped/0 failed; policy counts on the other checked tables were unchanged.

**Status:** applied and verified. Full detail in `DB_AUDIT_REPORT.md` §14. Remaining Block 1 RLS SHOWSTOPPER table count reduced from 7 to 6.

---

## 2026-07-12 — Block 1.4c: `closed_deals` legacy permissive RLS policies dropped

**What changed:** Applied migration `phase_1_4c_drop_closed_deals_permissive_policy` (draft committed `fdce71f`) — removed the three legacy permissive RLS policies on `closed_deals` (`closed_deals_select`, `closed_deals_insert`, `closed_deals_update`). No replacement policy was created; the existing scoped siblings (`closed_deals_tenant_select`, `closed_deals_tenant_insert`) were left untouched.

**Result:** `closed_deals` now keeps only the scoped SELECT/INSERT policies; UPDATE and DELETE have no policy and are default-deny for all roles.

**Verification:** apply succeeded; `pg_policies` for `closed_deals` returned exactly 2 policies after apply (the scoped pair); the gated `tests/closedDeals.migration.test.js` suite passed 4/4 against live Postgres; policy counts on the other checked tables were unchanged.

**Status:** applied and verified. Full detail in `DB_AUDIT_REPORT.md` §13. Remaining Block 1 RLS SHOWSTOPPER table count reduced from 8 to 7.

---

## 2026-07-12 — Block 1.4b: `email_threads` legacy permissive RLS policies dropped

**What changed:** Applied migration `phase_1_4b_drop_email_threads_permissive_policy` — removed the three legacy permissive RLS policies on `email_threads` (`tenant_email_threads_select`, `tenant_email_threads_insert`, `tenant_email_threads_update`). No replacement policy was created.

**Result:** `email_threads` now has RLS enabled with zero policies, so it is default-deny for all roles until a future scoped policy is intentionally designed.

**Verification:** apply succeeded; `pg_policies` for `email_threads` returned zero rows after apply; the gated `tests/emailThreads.migration.test.js` suite passed 3/3 against live Postgres; policy counts on the other checked tables were unchanged.

**Status:** applied and verified. Full detail in `DB_AUDIT_REPORT.md` §12.

---

## 2026-07-12 — Stock RPC authenticated grant fix (post-Block-1 regression)

**What changed:** Applied migration `phase_0_2_adjust_product_stock_authenticated_grant` (version `20260712144148`) — granted `authenticated` EXECUTE on the `adjust_product_stock` RPC. Block 0.2's RPC was originally `anon`-only, correct at the time since every backend request ran as `anon`; Block 1's JWT-authenticated request clients have since become the real stock-adjustment/import call path, and `authenticated` had never been granted EXECUTE, so those real calls were failing with permission-denied until this fix.

**Safety:** function remains `SECURITY INVOKER`; function body, RLS policies, and table grants all unchanged — verified read-only before/after apply.

**Status:** applied and verified. Full detail in `DB_AUDIT_REPORT.md` §11.

---

## 2026-07-06 — Block 0.3: sweeper claim-lock shipped, applied, and verified — Block 0 complete

**What changed:**
- Drafted, database-lead/security-lead-reviewed (database-lead GO, security-lead GO WITH CONDITIONS), and applied migration `phase2_sweeper_claim_lock` (version `20260706142919`) to live Supabase project `lmslyfxvvnvjojsymehy`: one new column, `smart_leads.claimed_at TIMESTAMPTZ` (nullable, no default, with a `COMMENT ON COLUMN`) — no other DDL, no RLS/policy changes, no grant changes.
- Fixes a real double-send bug in `lib/autoReplySweeper.js#sweepScheduledReplies`: the sweeper fetched due leads and dispatched a real customer-facing WhatsApp/email message with no claim in place beforehand — only the final "mark sent" write was guarded, which does nothing to stop two overlapping sweeper runs (overlapping ticks, two processes during a rolling deploy) from both dispatching the same message.
- Implementation: dispatch is now "claim, then act" — a single atomic conditional `UPDATE ... WHERE auto_reply_status='scheduled' AND (claimed_at IS NULL OR claimed_at < staleBefore)` runs before any dispatch attempt; only one concurrent caller can win it, the other skips instead of double-sending. A claim expires after 5 minutes so a crashed sweeper's stuck claim self-heals; an ordinary dispatch failure explicitly releases the claim for immediate retry.
- Post-apply, live-verified read-only: `smart_leads.claimed_at` exists (`timestamp with time zone`, nullable, no default), its column comment matches the reviewed text, and `pg_policies`/`role_table_grants` for `smart_leads` are unchanged before vs. after — this migration touched nothing but the one column.
- Gated real-Postgres suite (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/autoReplySweeper.migration.test.js`) run against the now-live column: 5/5 passed, including a **30-concurrent-sweep-pass test on one real due lead** proving the claim genuinely serializes concurrent writers on live Postgres — dispatch fired exactly once. Two bugs surfaced on the first gated run were fixed, both in the test file only (a cleanup-ordering bug and a timestamp string-vs-instant comparison bug), not in the migration or application logic; leftover rows from that first failed run were purged and a final check confirmed zero left behind. Full normal suite afterward: 330 passed / 22 skipped / 0 failed.

**Why:** Block 0's third and final data-safety-net item (`architecture.md` §6) — the sweeper is the only place in this codebase that auto-dispatches a real customer-facing message without human approval-in-the-loop (the MEDIUM-priority approval-window path), so a double-send here is a direct customer-facing reliability problem, not just an internal data-integrity one.

**⚠️ Critical finding surfaced during this migration's review — not fixed here, do not treat as resolved:** reviewing this change found that `smart_leads` and at least 8 other tables (`closed_deals`, `invoices`, `quotes`, `email_threads`, `call_logs`, `segments`, `smart_interactions`, `whatsapp_sessions`) carry **two overlapping RLS policy sets per command** — a correctly tenant-scoped set coexisting with an older, permissive set (e.g. `qual = true`, or a bare `deleted_at IS NULL` check with no tenant predicate). Since Postgres OR's multiple permissive policies together, the permissive set wins: these tables are **effectively not tenant-isolated today**, confirmed independently by Supabase's own security advisor (`rls_policy_always_true`). This is pre-existing debt that predates and is unrelated to any Block 0 work (0.1, 0.2, or 0.3) — verified `claimed_at` itself carries no sensitive data and its claim UPDATE doesn't reference `tenant_id` at all, so it neither worsens nor improves this gap. **This is a Block 1 pre-launch SHOWSTOPPER, not a Block 0.3 concern** — full detail in `DB_AUDIT_REPORT.md` §10 and §7 item 1. No real client/production traffic should route through any of the 9 affected tables until Block 1's `auth.uid() → tenant_id` mapping lands and the legacy permissive policies are dropped across all of them.

**Block 0 status: complete.** All three items — `failed_ingestions` dead-letter table (0.1), the atomic stock-movement RPC (0.2), and the sweeper claim-lock (0.3) — are now drafted, reviewed, applied, verified live, and documented. Block 1 (tenant auth/RLS cleanup, including the SHOWSTOPPER above) is not started. Decision Brain implementation is not started.

**How to apply:** Full detail in `DB_AUDIT_REPORT.md` §10. Next build step is Block 1 (tenant auth/RLS cleanup) — do not begin Decision Brain work before Block 1 is complete, and do not route real client traffic through the 9 flagged tables until Block 1's fix lands.

---

## 2026-07-03 — Block 0.2: atomic stock-movement RPC shipped, applied, and verified

**What changed:**
- Drafted, database-lead/security-lead-reviewed (both GO WITH CONDITIONS), and committed (`5f27de7`) a new Postgres function `public.adjust_product_stock(...)` — `SELECT ... FOR UPDATE` (row lock) + balance computation + `UPDATE products` + `INSERT stock_movements`, all atomic in one call. Fixes a real lost-update race in `controllers/products.js#adjustStock` (read → JS-computed balance → separate `UPDATE`/`INSERT`, no lock) and a confirmed live bug in `controllers/productImport.js` (opening-stock ledger writes assumed a `BEFORE INSERT` trigger that does not exist, so imported opening stock silently stayed at `stock_quantity = 0`).
- One pre-commit fix came out of the review itself: `productUpdateSchema` (`lib/catalogue.js`) still let `stock_quantity`/`status` through the generic `PATCH /api/products/:id`, bypassing the whole RPC and the ledger it's meant to keep in sync. Fixed before commit — that schema now explicitly omits both fields and is `.strict()`, rejecting (not silently stripping) any PATCH that includes them.
- Migration applied 2026-07-03 (version `20260703184137`). Post-apply live-ACL check found a second issue neither review caught: Postgres grants EXECUTE to `PUBLIC` by default on function creation, and this Supabase project's schema-level default privileges separately auto-grant EXECUTE to `authenticated` on every new function — so `PUBLIC` and `authenticated` both had access the reviewed migration never intended. Fixed same-day with a follow-up migration (version `20260703184604`) revoking both; live ACL is now exactly `{postgres, anon, service_role}`, matching the original intent.
- Gated integration suite (`RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/stockMovement.migration.test.js`) run against the now-live function: 6/6 passed, including a 20-way concurrent `+1`-delta test proving the row lock genuinely serializes concurrent writers on real Postgres (no lost updates, no ledger/balance divergence), and a tenant-mismatch test confirming cross-tenant rejection. Normal suite re-run clean afterward: 326 passed / 16 skipped / 0 failed.

**Why:** Block 0's second data-safety-net item (`architecture.md` §6) — stock correctness gates safe quoting, invoicing, and future Decision Brain behaviour, and the pre-fix code could silently lose stock updates or leave imported stock at zero with no error.

**Caveats, deliberately not resolved here:**
- The grants-fix SQL was applied directly via `apply_migration` and is not yet committed as its own tracked `.sql` file in the repo — tracked as follow-up debt (`DB_AUDIT_REPORT.md` §9) so the repo doesn't silently drift from what's actually live.
- The two orphaned functions found during investigation (`apply_stock_movement()`, referencing a table already dropped in an earlier migration; `prevent_stock_movement_mutation()`, unattached) were deliberately left untouched — tracked as separate hygiene cleanup, not bundled into this fix.
- Quote/invoice stock consumption is out of scope (no such path exists in the app yet).
- Block 0's third required piece — the auto-reply sweeper claim-lock (Block 0.3) — remains unbuilt. **Block 0 is still not complete.** Block 1 (tenant auth/RLS cleanup) is not started. Decision Brain implementation is not started.

**How to apply:** Full detail in `DB_AUDIT_REPORT.md` §9. Next build step is Block 0.3 (sweeper claim-lock) — do not begin Block 1 or Decision Brain work before Block 0 is fully cleared.

---

## 2026-07-02 — Block 0.1: `failed_ingestions` dead-letter table shipped and applied

**What changed:**
- App-layer dead-letter writes landed first (commit `3da2823`): `engine.js` now attempts a best-effort write to `failed_ingestions` on triage/parse failure, draft-generation failure, and the outer catch-all — never throws, never crashes the caller.
- Migration drafted next (commit `eebaba4`), reviewed by database-lead, security-lead, and cto-ai before being touched.
- Migration applied this session as version `20260702224053`: `failed_ingestions` table now exists with RLS enabled, verified live via read-only checks (table present, `relrowsecurity = true`, exactly one policy — `failed_ingestions_insert_temp_anon`, `anon`-scoped, INSERT-only, no SELECT/UPDATE/DELETE for anon/authenticated).
- Test results: normal suite unchanged at 317 passed / 9 skipped / 0 failed; the gated integration suite (`tests/failedIngestions.migration.test.js`, `RUN_DB_INTEGRATION_TESTS=true`) ran for the first time against the real table and passed 8/8, proving the RLS/constraint contract (FK violation, both size-cap violations, anon insert/select/update/delete behaviour) against real Postgres, not mocks.

**Why:** This is Block 0's first concrete piece (`architecture.md` §6) — the data-safety net that must exist and be verified before any process isolation or Decision Brain schema work begins. Until this migration applied, `engine.js`'s dead-letter writes were silently no-ops against a nonexistent table.

**Caveats, deliberately not resolved here:**
- Live inbound email still bypasses `engine.js` entirely, so failures on that path aren't yet covered by this dead-letter mechanism.
- `tenant_id_source` (`brand_dna` | `default_fallback`) defaults to `default_fallback` in every row because `engine.js` never sets it explicitly — a data-quality gap, not a migration blocker; tracked as a fast-follow.
- The `failed_ingestions_insert_temp_anon` policy (anon INSERT, no SELECT/UPDATE/DELETE) is a deliberate, time-boxed compromise — `engine.js` only has an anon-key Supabase client today. Target end-state is a server-side/service-role write path with this policy removed, once Block 1 (tenant-scoping auth fix) lands.
- Block 0's other two required pieces — the atomic stock-movement update and the sweeper claim-lock — remain unbuilt. Block 0 is not complete; only this dead-letter piece (Block 0.1) is done.

**How to apply:** Full detail in `DB_AUDIT_REPORT.md` §8. Do not treat Block 0 as cleared until the stock-update and claim-lock pieces also land and are verified.

---

## 2026-07-02 — Decision Brain MVP direction finalised

**What changed:**
- Product direction shifted from "AI sales inbox" wording toward **"autonomous commercial decision engine"** — Invisible Sales OS is now positioned as a controlled, specialist-agent **Decision Brain**, not a chatbot.
- Confirmed: not building a separate chatbot. Channels (WhatsApp, email, forms, and future adapters) are adapters onto one decisioning core, not separate products.
- The Decision Brain — not any single channel or UI — is now stated as the product's MVP.
- Controlled specialist-agent model adopted: sub-agents advise, the Orchestrator decides, a Safety Gate approves, an Action Layer executes, a Learning Layer records. No sub-agent may directly send, mutate critical state, or escalate.
- Orchestrator-owned final decision — one accountable decision point per message, not distributed autonomous agents.
- Escalation-last principle formalised: escalate only after buffering, classifying, clarifying, checking context, and attempting a safe fallback have all been tried.
- Conversation Throttle & Signal Buffer added to the design — suppresses duplicate/low-information message bursts before they reach any model call.
- Weak-intent "Hi" flow clarified: ask one clarifying question, don't escalate, don't ignore.
- Repeated spam/burst token-saving behaviour clarified: process a burst once, not once per message.
- Discount/promo learning direction clarified and **gated harder than originally proposed** (see Revenue Lead's condition below): record-only in MVP, no AI-suggested or auto-applied discounts.
- Raw conversations remain tenant-isolated audit/history; learning uses structured signals, not blind full-chat-history prompting.
- Development must proceed docs → tests → pure helpers → orchestrator → storage (the reconciled `architecture.md` §6 Block 0-16 order), not a rewrite.

**Why:** The product owner's assessment that the existing "AI inbox with an approval gate" framing undersold what the product actually needs to be, and a wish to formalise the judgment layer — not the reply — as the product itself.

**Board review (full board, all six roles, GO WITH CONDITIONS, zero NO-GOs):**

| Role | Verdict | Binding condition |
|---|---|---|
| Product Lead | GO WITH CONDITIONS | Collapse "15 specialist agents" to ~5 real implementation stages mapped onto existing code via an explicit mapping table (`product.md` §4/§5.2) — not a parallel rewrite. Flagged this pivot risks repeating the exact docs-vs-code gap just found in the approve-by-exception audit; sequencing fix applied. |
| CTO/AI | GO WITH CONDITIONS | One reconciled build order, not two competing "Block 0"s (`architecture.md`'s reconciliation note). No new LLM calls beyond the existing two (triage, draft). Decision Audit Log/Learning Event schema waits for Block 0. Documented that `lib/autoReply.js` is currently non-compliant with its own 2026-07-01 spec. |
| Database Lead | GO WITH CONDITIONS | Block 0 (data-safety net) must ship and be verified in production before any Decision Brain migration is drafted — hard sequential gate, not parallel. Minimal v1 schema only (append-only audit log + learning events); no materialised memory tables yet. Flagged the audit log as a larger, more continuous PII surface than `failed_ingestions`. |
| Security Lead | GO WITH CONDITIONS | Extended the standing pre-launch veto: no Safe Action Engine execution against real tenant data until `DEV_BYPASS_AUTH` is removed, tenant scoping is JWT-verified, webhook HMAC exists, and credentials are encrypted — because auto-execution turns the existing tenant-scoping gap into an impersonation-plus-action risk, not just a data read. Mandated `tenant_scope_verified`/`pii_sensitivity` fields in the agent output contract from day one. |
| Customer Success | GO WITH CONDITIONS | The "Decision Brain"/"autonomous commercial decisioning" language stays internal until `SURVEY.md` is actually run against real Lala owners — externally, keep describing the product as "automated replies, you're only pulled in when it matters." Mandated a customer-facing decision-reason surface and a global pause/override switch as MVP scope, not later polish. |
| Revenue Lead | GO WITH CONDITIONS | Positioning is commercially stronger, but flagged that autonomous action (not draft-and-wait) is a pricing-model input — decision-volume/action-based tiering under consideration alongside per-seat packaging. Discount auto-apply must be gated separately from record-only, not one continuous roadmap. Pricing reconciliation proceeds in parallel, must resolve before "decided" status. |

**How to apply:** `architecture.md` §6 is the single source of truth for build sequencing — Block 0 (data safety) and Block 1 (tenant-scoping auth fix) gate everything else; nothing in the Decision Brain layer (Blocks 6-16) begins before those two are verified in production, and nothing executes against real tenant data until Block 1 specifically clears. `USE_CASE_TESTS.md`'s 30 scenarios are the acceptance criteria for Blocks 7-16, written before any of that code exists — do not mark any of them 🟢 without a real test run.

---

## 2026-07-02 — Root directory cleanup + team documentation moved to Notion

**What changed:**
- Deleted 17 confirmed-dead files after per-category confirmation: dead JS modules (`LeadNormalizer.js`, `CloudAuth.js`, `optimizer.js`, `supabaseClient.js`, `index.js`, `train.js`), manual debug scripts (`debug-sheet.js`, `test-auth.js`, `test-whatsapp.js`, `test_env.js`), legacy static frontend (`public/app.js`, `public/index.html`, now-empty `public/` dir removed), stale planning docs superseded by already-live code (`PENDING_AUTH_ROUTES.md`, `PENDING_ROUTES_BILLING.md`, `PENDING_ROUTES_DIGEST.md`, `PENDING_ROUTES_ONBOARDING.md`), and an empty leftover `users.json`. Every deletion was verified via grep to have zero references before removal.
- Removed 5 unused npm dependencies (`pg`, `@google/generative-ai`, `axios`, `picomatch`, `qrcode-terminal`) — `pg` in particular had been a standing architecture-rule violation (raw Postgres bypassing RLS), only reachable via the now-deleted `train.js`. `package.json`'s stale `"main": "index.js"` repointed to `server.js` (the actual entry point). `npm install` run to sync the lockfile; **`npm test` re-confirmed 308/308 passing after the cleanup** — nothing load-bearing was touched.
- Cleaned up `.gitignore` entries that referenced the now-deleted files (`users.json`, the four debug scripts).
- Set up a Notion "Invisible Sales OS — Team Procedures" workspace (separate from this repo's specs) with pages for dev environment setup, testing procedure, database migration procedure, deployment readiness checklist, common issues/troubleshooting, and the board-agent consultation workflow — populated with real incidents from this session (e.g. the PM2 + manual-process port-3001 conflict) rather than generic placeholders.

**Why:** Product owner's assessment that the root directory had accumulated dead code and stale planning artifacts left over from earlier sessions, and a need for the team's operating procedures to live somewhere durable and shareable (Notion) rather than only in ad-hoc session memory.

**Not touched, deliberately:** `google-credentials.json` (real runtime dependency of the Google Sheets backup feature — flagged for hardening to an env-var + rotated key, not deleted), `.wwebjs_auth/`/`.wwebjs_cache/` (the live, paired WhatsApp session — deleting forces a QR re-scan).

**Update, same day:** `HOW_TO_TEST.md` was subsequently rewritten — replaced the dead `node index.js` full-pipeline test with a `curl POST /webhook/lead` example (a real, live route), corrected the login flow description (email/password + OAuth, not OTP — that changed since Session 0), updated the test baseline, and added a pointer to `USE_CASE_TESTS.md` for complex-scenario testing and the port-3001/PM2 conflict runbook (now documented in Notion).

---

## 2026-07-02 — Architecture reworked into block-by-block build order; product.md rewritten to current-state only

**What changed:**
- `product.md` rewritten to describe only the current, decided product — the approval-flow critique/decision narrative that previously lived in it (see 2026-07-01 entry below) was moved to this changelog so the spec doc stays a clean "what is" reference instead of a running "how we got here" narrative.
- `architecture.md` §5 added: a decided, ordered "block-by-block" build sequence (Block 0 data-safety net → Block 1 wwebjs supervisor subprocess → Block 2 circuit breakers → Block 3 per-subsystem health → Block 4 IMAP supervisor → Block 5 cron extraction), replacing the previous unordered "right-sized fixes" list.

**Why:** The product owner's own assessment: the current architecture "is not at all strong enough for industry level SaaS," and the product should be built and hardened "block by block" rather than attempting the whole system at once, with an explicit goal that **a failure in any one service must not take the whole product down.**

**Key input that shaped the order (Database Lead, consulted directly):**
- Splitting `server.js` into independent process fragments introduces **new** data-integrity risks that don't exist in the current single-process model: a lost-update race on the `stock_movements` ledger if two ingestion paths compute `balance_after` concurrently, and a double-dispatch race if two `autoReplySweeper` instances both claim the same scheduled reply during a rolling deploy.
- Database Lead **mandated** that a `failed_ingestions` dead-letter table plus the two concurrency fixes above (atomic stock-update RPC, sweeper claim-lock query) must exist *before* any process is extracted from `server.js` — this became **Block 0**, gating all subsequent blocks.
- No new tables/heartbeat-in-Postgres needed beyond `failed_ingestions`; per-subsystem health stays out of the database (in-memory + `/health` endpoint).

**How to apply:** Build strictly in Block 0 → 5 order (see `architecture.md` §5 for full detail per block, including what "done" looks like for each). Do not skip ahead to a later block because it looks easier — the ordering encodes real dependencies (e.g. Block 3's per-subsystem health reporting is meaningless before Blocks 1–2 exist to report on).

---

## 2026-07-01 — Approval-flow redesign decided

**What changed:** The "approval-first" auto-reply model (`tenants.auto_reply.enabled` defaulting to `false`, MEDIUM held for a 30-minute approval window) was replaced with an auto-send-by-default + approve-by-exception model:
1. `auto_reply.enabled` defaults to `true` for LOW.
2. MEDIUM is redesigned from a timed queue into "approve by exception" — auto-send unless a risk flag fires (price negotiation, stock ambiguity, first-time customer, high order value, negative sentiment).
3. A 60–120s undo/recall window added on auto-sent messages as a safety net.
4. HIGH stays always-manual, no exceptions.

**Why:** The product owner's direct critique: *"If a rep has to approve every message before it sends, they're good enough to have drafted it themselves — we haven't removed the owner's workload, we've relabelled it as a queue."* Confirmed by Product Lead board-agent review: shipping a confidence-triage engine switched off by default is a signal the product doesn't trust its own triage. For a WhatsApp-native, trust-driven customer already reading 50–200 messages a day, an owner who must still touch every message is a worse failure mode than an occasional imperfect auto-reply — the former guarantees churn, the latter is cheap to recover from in a relationship-driven trade.

**Also surfaced during this review (Product Lead):**
- A previously undocumented use case: **partial/split fulfillment** (order quantity exceeds available stock) — recommended to auto-offer partial dispatch + backorder as a reviewable draft, not silently confirm the full order or blindly escalate.
- Priority order for building out complex use cases: out-of-stock → price negotiation → high-value first-time order → stock-changing-mid-conversation → partial fulfillment → duplicate contact across channels → angry/urgent customer. Multi-language handling explicitly deprioritised for this pass (translation-quality problem, not an approval-logic problem).

**Explicitly rejected alternatives:** batch/digest approval (reintroduces latency into a channel whose value is speed); blanket auto-send-everything with no risk scoring (too coarse without a confidence signal).

**Scope note:** Treated as a change to the existing core loop, not new scope — didn't require Product Lead's cut-list gate. Safe pre-launch call (zero paying clients at decision time). Auto-send risk thresholds (order value, sentiment sensitivity) should become tenant-configurable once there's a first paying client — not hardcoded as "final" now.

**How to apply:** Implementation is scoped to `lib/autoReply.js`'s MEDIUM branch, the tenant default, and wiring existing `lib/escalation.js` risk-flag detection into the new exception gate — not a pipeline rewrite.

---

## 2026-07-01 — Initial vision.md / product.md / architecture.md created

**What changed:** Reconciled `PRODUCT_STRATEGY.md`, `ROADMAP.md`, `SESSION_2_CURRENT_STATE.md`, and `OPEN_TASKS.md` — which had drifted out of sync with each other and with the actual shipped code — into three focused, current documents: `vision.md` (why), `product.md` (what), `architecture.md` (how). Also researched an adjacent product (Asikaso.ai, an FB/IG messaging automation tool for SE Asian SMEs) for competitive context — see the research note shared in-session; not persisted as a file yet.

**Why:** The existing strategy docs disagreed with each other (three different pricing tables) and with the shipped codebase (some described-as-future features were already live). A single source of truth was needed before further product decisions could be made confidently.

---

## Open flags (not yet resolved, tracked here so they aren't lost)

- **Pricing reconciliation** — three different pricing tables exist across legacy docs (`PRODUCT_STRATEGY.md`: £35/£99/£249/£499; `SESSION_1_FOUNDATION.md`: £49/£149/£399; `ROADMAP.md`: $49/$149/$399/$799, different currency). Revenue Lead's domain — not resolved as of this entry.
- **Notion documentation workspace** — being set up (2026-07-02) as the team's canonical procedure/process documentation system, separate from these in-repo specs. Once live, decide whether these markdown docs stay the source of truth (mirrored to Notion) or Notion becomes primary — don't let two systems silently diverge.
