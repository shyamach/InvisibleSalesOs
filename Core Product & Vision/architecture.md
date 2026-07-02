# Invisible Sales OS — Architecture

_Last updated: 2026-07-02. Companion to `vision.md` and `product.md`. Reviewed by the full board (product-lead, cto-ai, database-lead, security-lead, customer-success, revenue-lead) on the Decision Brain direction — all six GO WITH CONDITIONS. §5-§6 are new; §1-§4 and §7 are the 2026-07-02 failure-isolation architecture, unchanged in substance but renumbered and cross-referenced against the reconciled build order in §6. For the process/decision history behind this doc, see `PRODUCT_CHANGELOG.md`._

**Reconciliation note, read first:** an earlier pass at this document proposed two separate "Block 0" sequences — one for failure isolation (this file, 2026-07-02) and a second, different one for the Decision Brain (proposed same day). CTO/AI's review flagged this explicitly: two competing Block 0s in the same repo guarantees confusion about which is current. §6 below is the single reconciled sequence. There is only one build order in this project. If you find a reference to a "Block" anywhere in this repo, it means §6.

---

## 1. Pipeline

```
┌─────────────── INGESTION (3 channels, structurally isolated) ───────────────┐
│  WhatsApp (Meta Cloud webhook   WhatsApp (wwebjs      Email (IMAP poll,     Web forms
│   + wwebjs live listener)        live listener)        60s cadence)         (POST /webhook/lead)
│  controllers/whatsapp.js         server.js             lib/emailListener.js controllers/leadWebhook.js
└───────────────────────────────────────┬──────────────────────────────────────┘
                                         ▼
                              engine.js (orchestrator)
                                         ▼
                    ┌── AI TRIAGE (Claude Haiku, ~400 tok) ──┐   ACTIVE · p95 < 5s
                    │  priority, language, intent            │
                    └──────────────────┬──────────────────────┘
                                        ▼
                    CATALOGUE CONTEXT (price/stock lookup)     ACTIVE · <2s, non-fatal timeout
                                        ▼
                    DRAFT GENERATION (Claude Sonnet)           ACTIVE · p95 < 20s
                                        ▼
                    SANITY / AUTO-REPLY GATE (lib/autoReply.js — pure function, zero I/O)
                        ├─ HIGH             → manual, always            LAZY (human, no SLA)
                        ├─ auto_dispatch    → send now                  ACTIVE · <5s
                        ├─ exception flag   → hold for review           LAZY (human, exception inbox)
                        └─ (no flag)        → auto-send                 ACTIVE
                                        ▼
                    DATABASE (Supabase: smart_leads, smart_interactions, ai_learning)
                                        ▼
                    INVENTORY / ESCALATION (lib/escalation.js — OOS, price-negotiation → rep)
                                        ▼
                    QUOTE / INVOICE (lib/invoiceParser.js, invoicePdf.js)              LAZY, never blocks the lead pipeline
                                        ▼
                    DISPATCH (outbox.js → Meta API / wwebjs / Resend)
```

**Total budget:** triage + draft + dispatch targets under 90 seconds end-to-end, matching what a WhatsApp-native customer expects from a human rep. **This is the pipeline the Decision Brain (§5) formalises and extends — it is not replaced.** Every box above maps onto a named role in §5.2.

### Stage definitions

| Stage | What it does | Failure behaviour |
|---|---|---|
| Ingestion | Normalises a raw channel payload into a compiled lead shape. Each channel is a separate file/entry point — no shared runtime state between them. | A crash in one channel's handler cannot touch another's (already true of the controller split; server.js's wwebjs client is the exception — see §4). |
| Triage | Haiku call, classifies priority/language/intent. The only mandatory synchronous AI step. | On failure: short-circuit to dead-letter/manual queue (§6 Block 0), never crash the request, never silently drop the lead. |
| Catalogue context | Best-effort Supabase lookup of live price/stock. | Non-fatal timeout — draft proceeds without it (already implemented in `engine.js`). |
| Draft generation | Sonnet call, produces the `outbound_draft` row. | On failure: lead is still saved with a `writer_failed` status; nothing is lost. |
| Sanity / auto-reply gate | Pure, deterministic, already unit-tested. Decides auto-dispatch vs. exception-hold vs. always-manual. | No I/O, cannot fail from an external outage. |
| Database | Supabase primary write, Google Sheets backup (fire-and-forget, non-blocking). | Sheets failure never blocks the primary write (already implemented). |
| Inventory / escalation | Routes OOS or negotiation leads to a human rep, re-checks stock before quote/invoice (see `product.md` §5, use case 4). | Escalation failure should not block the lead being saved. |
| Quote / invoice | Downstream artifact generation. | Always lazy — a PDF-generation failure must never block or delay the live conversation. |
| Dispatch | Channel-resolved send, with Meta → wwebjs fallback for `@lid` addresses. | Per-dependency circuit breaker (§4) — a slow/down channel provider fails fast into the manual queue instead of hanging the request. |

---

## 2. Active vs. lazy loading — defined

Not two parallel pipelines. One AI pipeline; a single fork point at the auto-reply gate, governed by one rule:

**Decision rule:** *does a human or an SLA clock need this in the next 90 seconds?*

```
if stage in [triage, draft_generation]              → ACTIVE, always, no exceptions
if gate.decision == auto_dispatch                    → ACTIVE, dispatch inline
if gate.decision in [exception_hold, manual]         → LAZY, resolved by human in /app/drafts, no latency SLA
if task in [digest, catalogue_resync, follow_up]     → LAZY, cron-only, never inline
```

| Stage | Mode | Target |
|---|---|---|
| Ingest → Triage | Active | p95 < 5s |
| Catalogue context | Active | < 2s, non-fatal |
| Draft generation | Active | p95 < 20s |
| Auto-dispatch send | Active | < 5s after draft |
| Exception-hold / manual | Lazy | resolved by exception inbox, no SLA |
| Follow-up engine | Lazy | 6h cron, throughput-bound not latency-bound |
| Weekly digest | Lazy | Monday 8am UTC, single run |
| IMAP poll | Lazy trigger → Active pipeline | 60s poll cadence; once pulled, a message enters the identical active path as WhatsApp |
| **Conversation Throttle & Signal Buffer (§5)** | **Lazy-gate, Active-once-released** | evaluates in <1s; either releases into the Active path immediately or holds/sleeps — see §5.9 |

---

## 3. Sanity layer

Two kinds of validation happen before anything reaches the database or goes out:
1. **Schema validation** (Zod) — already in place on the form webhook (`lib/webhookLeadSchema.js`) and catalogue (`lib/catalogue.js`). Extend the same pattern to the Generic Commercial Object (`docs/GENERIC_COMMERCIAL_SCHEMA.md`) when it's built.
2. **Business-rule sanity** — the auto-reply gate itself (`lib/autoReply.js`) plus the stock-availability check that must run immediately before quote/invoice generation (not just at initial reply time — this is the fix for `product.md`'s use case 4, stock changing mid-conversation).

Both are pure, synchronous, and cheap — they should never be the latency bottleneck in the active path. The Decision Brain's Risk + Confidence Gate (§5.3) is this same layer, formalised.

---

## 4. Failure isolation

The product owner's requirement: **a breakdown in any one service must not take the whole product down.** This is sized for a pre-revenue, single-process product — not a premature move to microservices, Redis, or Edge Functions.

### Already structurally sound (keep exploiting this)
- `controllers/*.js` — each ingestion channel has its own file and try/catch; a throw in `whatsapp.js` cannot touch `email.js` or `leadWebhook.js`.
- `lib/autoReply.js` — pure function, no I/O, cannot fail from an external outage.
- `outbox.js` — single dispatch chokepoint with Meta → wwebjs fallback already coded.
- Non-fatal `.catch()` wrapping already present for Sheets backup, catalogue context, and contact lookup — these are the model pattern; replicate them everywhere an external call isn't on the critical path.

### Genuine single points of failure today
1. **`server.js` is the whole company.** The whatsapp-web.js `Client` (Puppeteer/Chromium) is instantiated at module scope in the *same process* as Express, every API route, and every cron scheduler (follow-up, digest, auto-reply sweeper). A Puppeteer crash or Chromium OOM can take the entire backend down — including email and form ingestion, which have nothing to do with WhatsApp.
2. **No queue between ingestion and AI.** If the Claude API is down during triage, `engine.js`'s try/catch returns `{success:false}` and the inbound message is **lost** — not retried, not parked anywhere. Confirmed still live by direct code inspection, 2026-07-02.
3. **No circuit breaker on any external call** (Anthropic, Resend, Meta, Stripe). Each is a bare `await` in a local try/catch; a slow or down dependency stalls that one request with no breaker to stop retry storms or flip to a degraded mode automatically.

**Explicitly not recommended at this stage:** microservices, Redis, Kubernetes, or splitting into separate deployable services. Zero paying clients today — the supervisor-process + dead-letter-table + circuit-breaker pattern captures most of the resilience value at near-zero added operational complexity.

---

## 5. Decision Brain target architecture

This section is new. It does not replace §1-§4 — it formalises the same pipeline into named, accountable roles and adds two genuinely new components (the throttle/buffer and the audit/learning layer). Reviewed and conditioned by the full board; conditions are inline, not a separate list.

### 5.1 Target flow

```
Any channel input
  → Conversation Throttle & Signal Buffer   [NEW]
  → Signal Classifier                       [REFRAME: AI_Triage.js, extended schema]
  → Intent Discovery                        [REFRAME: branch on classifier output]
  → Normalised Commercial Object            [NEW: schema, not a service]
  → Decision Orchestrator                   [REFRAME: engine.js]
  → Specialist Decision Functions           [mostly REFRAME: catalogueContext.js + new DB lookups, run in parallel]
  → Risk + Confidence Gate                  [REFRAME: lib/autoReply.js, extended]
  → Safe Action Engine                      [REFRAME: outbox.js / escalationService.js]
  → Decision Audit Log                      [NEW]
  → Memory/Learning Engine                  [REFRAME: ai_learning table, extended into structured events]
  → Dispatch / Quote / Invoice / Follow-up / Escalation   [existing, unchanged]
```

### 5.2 How the current pipeline evolves — explicit mapping

| §1 pipeline stage (today) | Decision Brain role (§5.1) | Change required |
|---|---|---|
| Ingestion (3 channels) | Channel adapters | None — already correctly isolated |
| *(nothing today)* | Conversation Throttle & Signal Buffer | **New component** — see §6 Block 7 |
| AI Triage (Haiku) | Signal Classifier + Intent Discovery | Extend output schema with the 10 categories in `product.md` §5 |
| *(nothing today)* | Normalised Commercial Object | **New schema** — see `docs/GENERIC_COMMERCIAL_SCHEMA.md`, §6 Block 9 |
| Catalogue context | Specialist Decision Functions (product/inventory/pricing) | Extend to also pull customer/payment-risk/discount/policy context, still as plain parallel lookups, not new agents |
| Draft generation (Sonnet) | Response/Execution role's drafting half | Unchanged |
| Sanity/auto-reply gate | Risk + Confidence Gate + Next-Best-Action | Must first be brought into compliance with its own already-decided spec (`product.md` §4) — this is a prerequisite, not part of the Decision Brain work itself |
| Database write | *(unchanged)* | None |
| Inventory/escalation | Safe Action Engine's escalation path | Unchanged |
| Quote/invoice | Safe Action Engine's commercial-artifact path | Unchanged |
| Dispatch | Safe Action Engine's send path | Unchanged |
| `ai_learning` table | Memory/Learning Engine | Extend into structured, typed learning events (§ product.md §11) |
| *(nothing today)* | Decision Audit Log | **New table** — Database Lead + Security Lead review required before migration, see §6 Block 13 |

**No rewrite. Two new components (throttle, audit/learning), one new schema (commercial object), and formalisation of what already exists.** This table is the artifact Product Lead's review required before any orchestrator code is written.

### 5.3 Specialist-agent architecture principles

- Specialist decision functions **advise** — they return structured findings, never act.
- The **Decision Orchestrator** (existing `engine.js`, extended) makes the one final call per message.
- The **Risk + Confidence Gate** (existing `lib/autoReply.js`, extended) approves or blocks that call before anything happens.
- The **Safe Action Engine** (existing `outbox.js`/`escalationService.js`) is the *only* layer allowed to execute — send a message, write a quote, escalate to a rep.
- The **Learning Layer** records outcomes; it never feeds back into a live decision synchronously (no closed-loop retraining in MVP).
- No specialist role may directly send a message, generate an invoice, mutate critical state, or trigger an escalation. If a role's finding implies one of those actions, it's a *recommendation* the Orchestrator + Gate must approve first.
- Every role returns structured output — no free-text findings passed silently downstream.

### 5.4 Agent output contract

```json
{
  "agent_name": "risk_confidence_agent",
  "status": "success",
  "confidence": 0.86,
  "findings": {},
  "risk_flags": [],
  "recommendation": "continue",
  "requires_human": false,
  "reason": "No commercial risk detected.",
  "fallback": null,
  "learning_signals": [],
  "tenant_scope_verified": false,
  "pii_sensitivity": "standard"
}
```

**The last two fields are Security Lead's binding condition, specified now even though nothing executes against real tenant data yet (§7):** `tenant_scope_verified` — the Safe Action Engine refuses to execute if this is `false`, no override, no exception. `pii_sensitivity` — an enum (`none` / `standard` / `sensitive`) informing how the Decision Audit Log and Learning Engine handle this record's retention and redaction. Retrofitting either field after roles exist in code means auditing every historical decision after the fact — that cost is avoided by specifying the contract before any code is written, not after.

### 5.5 Failure handling

If one specialist function or the classifier call fails:
- Do not crash the whole pipeline — the failing role returns a `status: "error"` finding with an empty/conservative default, not an exception that propagates.
- Produce a safe fallback (e.g., pricing lookup fails → gate defaults toward manual review, never toward auto-send on an unknown price).
- Log the failure to the Block 0 dead-letter table (§6) — this is the *same* mechanism already specified for triage/draft failures, not a second one.
- Escalate only when the fallback itself can't safely proceed — consistent with `product.md` §9's escalation-last principle.

### 5.6 Deterministic vs. AI roles

Not every role is a model call. Restated from `product.md` §4's table, grouped by mechanism:

| Mechanism | Roles |
|---|---|
| Deterministic / rules | Conversation Throttle & Signal Buffer, Tenant Policy |
| DB lookup | Product, Customer, Inventory, Pricing, Payment/Risk |
| DB/rules (record-only in MVP) | Discount & Promo Intelligence |
| Cheap model / rules | Signal Classification (extends the existing Haiku call — no new call added) |
| Rules + optional AI | Risk & Confidence |
| LLM | Response/Execution's drafting half (existing Sonnet call — no new call added) |
| Structured writer, no model | Learning & Memory |

**Total LLM calls per message: unchanged from today (one Haiku, one Sonnet).** This is a hard condition from both CTO/AI's and Revenue Lead's reviews — the Decision Brain adds judgment, not model spend.

### 5.7 Parallel execution

After the Normalised Commercial Object exists, these run as parallel plain async functions (not sequential, not separate processes):

Product · Customer · Inventory · Pricing · Payment/Risk

Then, sequentially, once their results are assembled into one context object:

Discount/Promo (record-only) · Risk & Confidence · Next-Best-Action · Response/Execution · Learning

### 5.8 Data and tenant isolation

- Raw chat content, decision logs, and learning events are all tenant-isolated at the RLS level — not application-layer discipline alone (Database Lead's condition).
- Tenant A's raw data must never train or influence Tenant B's decisioning. No cross-tenant learning pipeline exists or is planned.
- This must respect the known, still-open tenant-scoping blocker (§7) — a Decision Audit Log or Learning Engine built before that gate closes would inherit the same vulnerability the rest of the product has, applied to a much larger, continuously-written data surface.

### 5.9 Cost/token efficiency

- The Conversation Throttle buffers rapid bursts before anything reaches the classifier — a 200-message burst becomes one processing pass, not 200.
- Duplicate/low-information messages are suppressed before any model call, not after.
- The Learning Engine retrieves structured summaries for future context, never blind full-chat-history replay into a prompt (see `docs/LEARNING_MEMORY_ARCHITECTURE.md` for why).
- Cheap deterministic checks (throttle, DB lookups) always run before any model call.
- The larger model (Sonnet) is used only at the drafting step, exactly as today — nothing in this design adds a new LLM call.

---

## 6. Block-by-block build order (single, reconciled sequence)

Every block below is a **process or module boundary inside the current repo** — not a new deployable service, not microservices. Ordered by (a) blast radius for Blocks 0-5 (unchanged from the original failure-isolation plan) and (b) hard data/auth prerequisites for Blocks 6-16 (the Decision Brain work, gated behind 0-5 per Database Lead and Security Lead's explicit mandates). **Build and verify each block before starting the next. Do not reorder. Do not start Block 6 before Block 0 is verified in production, and do not start Block 11 before Block 1 is verified in production** — these two gates are non-negotiable board conditions, not suggestions.

### Failure-isolation foundation (unchanged from the 2026-07-02 plan)

**Block 0 — Data-safety net.** `failed_ingestions` table (append-only, `tenant_id NOT NULL`, RLS), atomic stock-movement update (Postgres function or `SELECT ... FOR UPDATE`, replacing app-computed `balance_after`), sweeper claim-lock (`FOR UPDATE SKIP LOCKED`). *Verify:* kill the Anthropic key in a test env, confirm all 3 channels land failures in `failed_ingestions`, no 500s to webhook callers. **Gates all of Blocks 6-16 below — confirmed unbuilt as of 2026-07-02.**

**Block 1 — Tenant-scoping auth fix.** Wire `requireAuth` + `req.tenantId` onto `products.js`, `escalations.js`, `team.js`, `settings.js`, `productImport.js` (currently only `/api/auth/*` and `/api/billing/*` are protected — confirmed by direct code inspection). Estimated under a day; Security Lead's cheapest available large risk reduction. *Verify:* a request with a spoofed `x-tenant-id` header is rejected once no valid JWT session backs it. **Gates Block 11 (Decision Orchestrator) and everything downstream of it — no Safe Action Engine work begins before this lands.**

**Block 2 — wwebjs supervisor subprocess.** Move the `whatsapp-web.js` `Client` out of `server.js` into its own supervised child process. *Verify:* `kill -9` the child under load, confirm zero impact on other routes/channels.

**Block 3 — Per-dependency circuit breakers.** Anthropic, Meta/wwebjs, Resend, Stripe calls wrapped with a breaker that short-circuits to the Block 0 dead-letter table. *Verify:* black-hole endpoint test, breaker opens and self-heals.

**Block 4 — Per-subsystem `/health`.** Reports `{ whatsapp, imap, ai, db }` independently. *Verify:* degrade each subsystem individually, confirm isolated reporting.

**Block 5 — IMAP supervisor + cron extraction.** IMAP listener isolated into its own supervised child (reusing Block 2's harness); `follow_up`/`weekly_digest`/`auto_reply_sweeper`/`digest_scheduler` extracted into one `cron-runner.js` process. *Verify:* force an exception in one cron job, confirm Express and the supervised children are unaffected.

**End state of Blocks 0-5:** `server.js` is Express + routes only, talking to supervised children over IPC/HTTP, plus a data-safety net and a tenant-scoping fix. This is the foundation the Decision Brain is built on top of, not in parallel with.

### Decision Brain (gated behind Block 0 for data safety, Block 1 for the Action Layer specifically)

**Block 6 — Decision Brain docs + test-scenario design.** Largely complete as of this document; formalises `USE_CASE_TESTS.md`'s Decision Brain scenarios as fixtures. No production behaviour change. Can run in parallel with Blocks 0-5 since it's docs-only.

**Block 7 — Conversation Throttle & Signal Buffer.** Pure helper + tests. Deterministic — burst detection, duplicate suppression, weak-intent cooldown, sleep/wake states (see `docs/CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md`). *Prerequisite: Block 0 (shares the same claim-lock discipline the sweeper needs).*

**Block 8 — Signal Classifier extension + weak-intent tests.** Extends the existing Haiku triage call's output schema with the categories in `product.md` §5. No new LLM call.

**Block 9 — Generic Commercial Object schema helper.** Pure schema/shape, no DB, no migration (`docs/GENERIC_COMMERCIAL_SCHEMA.md`).

**Block 10 — Specialist decision function contracts.** The output contract in §5.4, including the `tenant_scope_verified`/`pii_sensitivity` fields, specified and unit-tested against synthetic data only.

**Block 11 — Decision Orchestrator pure function.** Wraps and extends the existing `autoReply.js` gate logic with the new context. *Hard prerequisite: Block 1 (tenant-scoping auth fix) must be verified in production first — Security Lead's explicit condition.*

**Block 12 — Wire into `engine.js` without behaviour break.** This is also where `lib/autoReply.js` is finally brought into compliance with its own already-decided approve-by-exception spec (`product.md` §4) — closing the gap identified in the 2026-07-02 code audit.

**Block 13 — Decision Audit Log storage design + migration.** Schema drafted per §5.4's contract; requires explicit Database Lead **and** Security Lead sign-off on redaction/retention before `apply_migration` runs — this table captures full commercial context on every decision, a materially larger PII surface than `failed_ingestions`.

**Block 14 — Learning Event storage design + migration.** Same review gate as Block 13. Tenant-isolated at the RLS level from day one.

**Block 15 — Discount/promo intelligence, record-only.** Per Revenue Lead's harder gate: record manual discounts, promo usage, and outcomes only. Suggestion and auto-apply are explicitly **not** scheduled here — each requires its own separate board review as a future, distinct GO decision.

**Block 16 — Advanced channel adapters.** Instagram, voice, PDF, image, Tally sync. Phase 2+, gated on the same client-signal and GDPR-review requirements already standing in `product.md`'s cut list.

**No migrations happen before the schema in Blocks 13-14 is explicitly approved. No microservices at any point in this sequence.**

---

## 7. Pre-launch gate (extended for the Decision Brain)

Security Lead's veto stands, and now explicitly covers more than login: **no paying client, and no Safe Action Engine execution against real tenant data in any environment beyond local dev with synthetic data**, until `DEV_BYPASS_AUTH=true` is removed, tenant scoping moves from the caller-controlled `x-tenant-id` header to a verified-JWT `req.tenantId` (Block 1), webhook HMAC verification exists, and third-party credentials move out of JSONB into encrypted storage (Supabase Vault).

**Why this gate has more force for the Decision Brain than it did before (Security Lead's review):** the previous model was human-approve-everything, so a tenant-scoping breach meant a person would eventually see and could catch a leaked draft. The Decision Brain auto-executes. An unverified caller exploiting the open tenant-scoping gap could trigger the Safe Action Engine to send a message, generate a quote, or take other irreversible external action *as* another tenant — impersonation plus action, not just a data read. This architecture does not relax that gate; it raises the cost of leaving it open.
