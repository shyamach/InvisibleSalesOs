# Invisible Sales OS — Product & Spec Changelog

_Tracks how the product spec itself has changed over time and why — the process, not the current state. For the current state, read `product.md` (what) and `architecture.md` (how). Reverse chronological — newest first._

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
