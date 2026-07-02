# Invisible Sales OS — Product & Spec Changelog

_Tracks how the product spec itself has changed over time and why — the process, not the current state. For the current state, read `product.md` (what) and `architecture.md` (how). Reverse chronological — newest first._

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
