# Invisible Sales OS — Architecture Proposal

_Last updated: 2026-07-02. Companion to [vision.md](vision.md) and [product.md](product.md). Reviewed with CTO/AI and Database Lead. Describes the target pipeline shape, defines "active vs lazy loading," lays out failure-isolation boundaries, and (§5) a decided block-by-block build order — sized for a pre-revenue single-process product, not a premature microservices rewrite. For the process/decision history behind this doc, see `PRODUCT_CHANGELOG.md`._

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

**Total budget:** triage + draft + dispatch targets under 90 seconds end-to-end (ROADMAP.md's time-to-first-draft target), matching what a WhatsApp-native customer expects from a human rep.

### Stage definitions

| Stage | What it does | Failure behaviour |
|---|---|---|
| Ingestion | Normalises a raw channel payload into a compiled lead shape. Each channel is a separate file/entry point — no shared runtime state between them. | A crash in one channel's handler cannot touch another's (already true of the controller split; server.js's wwebjs client is the exception — see §4). |
| Triage | Haiku call, classifies priority/language/intent. The only mandatory synchronous AI step. | On failure: short-circuit to dead-letter/manual queue (§5), never crash the request, never silently drop the lead. |
| Catalogue context | Best-effort Supabase lookup of live price/stock. | Non-fatal timeout — draft proceeds without it (already implemented in `engine.js`). |
| Draft generation | Sonnet call, produces the `outbound_draft` row. | On failure: lead is still saved with a `writer_failed` status; nothing is lost. |
| Sanity / auto-reply gate | Pure, deterministic, already unit-tested. Decides auto-dispatch vs. exception-hold vs. always-manual. | No I/O, cannot fail from an external outage. |
| Database | Supabase primary write, Google Sheets backup (fire-and-forget, non-blocking). | Sheets failure never blocks the primary write (already implemented). |
| Inventory / escalation | Routes OOS or negotiation leads to a human rep, re-checks stock before quote/invoice (see product.md §5, use case 4). | Escalation failure should not block the lead being saved. |
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

---

## 3. Sanity layer

Two kinds of validation happen before anything reaches the database or goes out:
1. **Schema validation** (Zod) — already in place on the form webhook (`lib/webhookLeadSchema.js`) and catalogue (`lib/catalogue.js`). Extend the same pattern anywhere new inbound shapes are added.
2. **Business-rule sanity** — the auto-reply gate itself (`lib/autoReply.js`) plus the stock-availability check that must run immediately before quote/invoice generation (not just at initial reply time — this is the fix for product.md's use case 4, stock changing mid-conversation).

Both are pure, synchronous, and cheap — they should never be the latency bottleneck in the active path.

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
2. **No queue between ingestion and AI.** If the Claude API is down during triage, `engine.js`'s try/catch returns `{success:false}` and the inbound message is **lost** — not retried, not parked anywhere.
3. **No circuit breaker on any external call** (Anthropic, Resend, Meta, Stripe). Each is a bare `await` in a local try/catch; a slow or down dependency stalls that one request with no breaker to stop retry storms or flip to a degraded mode automatically.

### Right-sized fixes (in priority order)
1. **Isolate the wwebjs client into its own supervised child process** (or at minimum wrap its init/crash handling so a Puppeteer failure restarts that subsystem without touching Express). This alone removes the single biggest blast radius in the system.
2. **Add a `failed_ingestions` dead-letter table in Supabase.** When triage or draft generation throws, insert the raw payload + channel + error there instead of only logging to console. Turns "message silently lost" into "queued for manual replay" — this is the direct fix for "the product should not fail" without standing up real queue infrastructure (BullMQ/Redis) yet.
3. **Per-dependency circuit breaker** on Anthropic/Resend/Meta/Stripe calls — N consecutive failures opens the breaker for a cooldown window, failing fast into the dead-letter/manual queue instead of hanging requests. A small hand-rolled breaker (or `opossum`) is enough; no new infra.
4. **Per-subsystem health reporting.** `/health` should report `{ whatsapp, imap, ai, db }` independently rather than one boolean, so a dead WhatsApp session is visible without implying email or forms are also down.

**Explicitly not recommended at this stage:** microservices, Redis, Kubernetes, or splitting into separate deployable services. Zero paying clients today — the supervisor-process + dead-letter-table + circuit-breaker pattern captures most of the resilience value at near-zero added operational complexity. Revisit at the point multi-instance scaling is actually needed (tracked already in `OPEN_TASKS.md` as a pre-launch security/scale item for the rate limiter and sweeper).

---

## 5. Block-by-block build order

The product owner's directive: stop trying to build or fix the whole system at once. Fragment it — each block below is a **process or module boundary inside the current repo** (not a new deployable service, not microservices), ordered strictly by blast radius, decided jointly by CTO/AI and Database Lead. Build and verify each block before starting the next; don't reorder.

**Block 0 — Data-safety net (gates everything else; Database Lead mandate).** Before any process is pulled out of `server.js`, three data-layer fixes must land, because splitting a monolith into fragments only helps if a crash in one fragment can't silently corrupt or lose data in another:
- `failed_ingestions` table (append-only, `tenant_id NOT NULL`, RLS) — wire `engine.js`'s triage/draft try/catch to write here instead of returning `{success:false}` and dropping the message.
- Atomic stock-movement update — move `balance_after` computation into a Postgres function (`UPDATE products SET stock_quantity = stock_quantity + delta RETURNING stock_quantity`, or `SELECT ... FOR UPDATE`) instead of computing it in application code. Fixes a lost-update race that becomes live the moment two ingestion paths can run concurrently.
- Sweeper claim-lock — `autoReplySweeper` must claim rows atomically (`UPDATE ... WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED)`) so two sweeper instances (rolling deploy, crash-restart overlap) can't double-dispatch the same scheduled reply.
*Verify:* kill the Anthropic key in a test env, send a lead through all 3 channels, confirm all 3 land in `failed_ingestions` with correct channel attribution and no 500s bubble to the webhook caller.

**Block 1 — wwebjs supervisor subprocess.** Move the `whatsapp-web.js` `Client` (Puppeteer/Chromium) out of `server.js` into its own child process (`child_process.fork` or a standalone `whatsapp-worker.js`), talking to the main process over IPC or a local HTTP port. Everything else stays put. *Why here:* it's the only component that can OOM/segfault the entire Node process; everything else is already contained by try/catch (§4's "already structurally sound" list). *Verify:* `kill -9` the child process under load on `/api/products`, `/health`, and email ingestion; confirm zero impact, and confirm a WhatsApp reconnect doesn't require a full server restart.

**Block 2 — per-dependency circuit breakers.** Wrap the bare `await`s on Anthropic (`AI_Triage.js`, `responder.js`), Meta/wwebjs (`outbox.js`, `lib/metaSend.js`), Resend (`lib/emailSend.js`), and Stripe (`controllers/billing.js`) in a small breaker (hand-rolled or `opossum`) that opens after N consecutive failures and short-circuits straight to the Block 0 dead-letter table. *Verify:* point a call at a black-hole endpoint, confirm the breaker opens after N failures, subsequent calls fail in <50ms, and it self-heals after cooldown.

**Block 3 — per-subsystem `/health`.** `/health` reports `{ whatsapp, imap, ai, db }` independently instead of one boolean — only meaningful once Blocks 1–2 exist as separately-failable subsystems to report on. *Verify:* degrade each subsystem one at a time (kill the wwebjs child, stop IMAP polling, flip a breaker) and confirm `/health` reflects exactly that one subsystem as down.

**Block 4 — IMAP listener as its own supervised child**, same pattern as Block 1. Lower priority than wwebjs because IMAP failures are already more contained (no Puppeteer memory risk), but cheapest to do right after Block 1 while the supervisor harness is fresh — reuse it, don't build a second one.

**Block 5 — cron schedulers extracted into a single scheduler entrypoint.** `follow_up`, `weekly_digest`, `auto_reply_sweeper`, `digest_scheduler` (currently all `start*()` calls living in `server.js`'s module scope) move into one `cron-runner.js` process that imports the same `lib/*` functions but doesn't share a process with Express. Last, because crons are already lazy (§2, no SLA) — but an unhandled rejection in the sweeper can still crash the API process today. *Verify:* force an exception in one cron job, confirm Express and the two supervised children (WhatsApp, IMAP) are unaffected.

**End state:** `server.js` is Express + routes only, talking to three supervised children (WhatsApp, IMAP, cron-runner) over IPC/HTTP, each independently restartable, plus a data-safety net that guarantees no lead is silently lost during any of it. No new infrastructure (no Redis, no queue broker, no separate deploys) — a real queue (BullMQ) only becomes justified once Block 0's dead-letter table is being replayed manually often enough to hurt.

**Explicit non-goal:** none of this changes the schema, RLS, or Supabase project topology — all six blocks stay on one Supabase instance with one connection pool. If "independently-deployable fragments" later means literal separate services (not just separate processes), that's a connection-pooling and migration-ownership conversation to have deliberately before it happens, not a side effect of this build order.

---

## 6. Pre-launch gate (unchanged, restated here for visibility)

Security Lead's veto stands independent of the above: no paying client until `DEV_BYPASS_AUTH=true` is removed, tenant scoping moves from the caller-controlled `x-tenant-id` header to a verified-JWT `req.tenantId`, and third-party credentials move out of JSONB into encrypted storage (Supabase Vault). This architecture proposal does not change or relax that gate.
