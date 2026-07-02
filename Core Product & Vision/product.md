# Invisible Sales OS — Product Spec

_Last updated: 2026-07-01. Companion to [vision.md](vision.md) (the why) and [architecture.md](architecture.md) (the how). This file reconciles `PRODUCT_STRATEGY.md`, `ROADMAP.md`, `SESSION_2_CURRENT_STATE.md` and `OPEN_TASKS.md` into current source of truth for product scope — where they disagree, this file wins going forward._

---

## 1. Ingestion channels

Three channels are live today, treated as **equal, first-class inbound sources** feeding one pipeline:

| Channel | Path | Status |
|---|---|---|
| **WhatsApp** | Meta Cloud API webhook (production) + whatsapp-web.js live listener (dev / `@lid` fallback) | Live |
| **Email** | IMAP polling in (`lib/emailListener.js`, 60s poll), Resend for outbound (`lib/emailSend.js`) | Live, co-equal channel — same triage/draft/approval pipeline as WhatsApp, not a stub |
| **Web forms** | Generic `POST /webhook/lead` (Tally, Typeform, custom forms), Zod-validated, rate-limited | Live |

Not yet built (do not start without the gates in §6): Tally ERP sync, image/PDF/voice-note ingestion, Instagram/Messenger DMs, website chat widget.

Every channel normalises into the same lead shape before entering the AI pipeline — see [architecture.md](architecture.md) for the ingestion-to-triage flow and why each channel is a structurally separate entry point (failure isolation).

---

## 2. The approval model — critique, decision, and redesign

### What ships today

`lib/autoReply.js` triages every lead into HIGH / MEDIUM / LOW:
- **LOW** → auto-dispatch, but only if the tenant has opted in (`tenants.auto_reply.enabled`, **defaults to `false`**)
- **MEDIUM** → held for a 30-minute approval window, then auto-dispatches unless rejected
- **HIGH** → always manual, no exceptions

### The critique (raised directly by the product owner, confirmed by Product Lead review)

> If a rep has to approve every message before it sends, they're good enough to have drafted it themselves. We haven't removed the owner's workload — we've relabelled it as a queue.

This is correct, with one caveat: MEDIUM's *timed* approval window is a defensible backstop, not the problem. The problem is that **LOW ships disabled by default**, so in practice almost everything sits in a queue regardless of the AI's own confidence. Shipping a confidence-triage engine switched off is a signal we don't trust our own triage — the fix is to trust it, not to keep the toggle off indefinitely.

For this customer specifically — a WhatsApp-native, trust-driven owner already reading 50–200 messages a day, comparing us against instant human replies — **an owner who must still touch every message has bought an expensive notification system, not sales automation, and will churn.** An occasional imperfect auto-reply on price or stock is recoverable in a relationship-driven trade; a rep manually clearing an approval queue all day is not.

### The redesign (decided, not just proposed)

1. **Flip the default: `auto_reply.enabled = true` for LOW.** Routine, repetitive queries (price check, "is X in stock," delivery time, "send me the catalogue") fire-and-forget with no human touch, out of the box.
2. **Redesign MEDIUM from "timed queue" to "approve by exception."** Auto-send MEDIUM too. Only surface a message for human review if a specific risk flag fires: price negotiation, stock ambiguity, first-time customer, order value above a tenant-configurable threshold, or negative sentiment. The Approval UI becomes an exception inbox, not a queue you clear.
3. **Add a short undo/recall window (60–120s) on every auto-sent message** as a safety net, not the primary gate — WhatsApp still allows delete-for-everyone in that window.
4. **HIGH stays always-manual.** No exceptions. This is the one place a human should always be in the loop.

**Explicitly rejected:** batch/digest approval (reintroduces latency into a channel whose entire value is speed) and blanket auto-send-everything with no risk scoring (too coarse without the confidence signal underneath it).

**Scope note:** this is a change to the core loop, not a new feature — it does not need to clear the cut-list gate, and it's a safe call to make pre-launch (zero paying clients today; the wrong default costs a config change, not a client). The specific auto-send risk thresholds (order value, sentiment sensitivity) should become tenant-configurable at client #1, since real risk tolerance can't be guessed from here — flag for Revenue Lead / first-client feedback, don't hardcode a "final" number now.

**Implementation note:** this only requires changes to `lib/autoReply.js`'s MEDIUM branch and the tenant default, plus wiring risk-flag detection (much of which already exists in `lib/escalation.js`'s OOS/price-negotiation detection) into the approve-by-exception gate. Not a rewrite of the pipeline — see [architecture.md](architecture.md) for exactly where this sits in the flow.

---

## 3. Complex use cases

The product's value is proven or disproven at these moments, not on the happy path. Priority order, per Product Lead review:

1. **Out-of-stock at time of reply.** Customer asks for a product that's below `reorder_point` or at zero stock. → Routes into the existing escalation path (`lib/escalation.js`), never auto-confirms a sale the business can't fulfil.
2. **Price negotiation.** Customer haggles outside standard pricing. → Always an escalation trigger (already built), never resolved by auto-reply regardless of LOW/MEDIUM/HIGH — negotiation is judgment, not lookup.
3. **High-value first-time order.** New contact, order value above threshold. → Treated as HIGH regardless of triage confidence; biggest single financial exposure per mistake.
4. **Stock changing mid-conversation.** Customer confirms an order, but stock sells out (via another channel) before dispatch is finalised. → Needs an explicit re-check against `stock_movements` immediately before quote/invoice generation, not just at initial reply time. **Currently a gap** — flagged as a real concurrency risk once multiple channels write to the same product ledger concurrently.
5. **Partial / split fulfillment.** Customer orders 5 units, only 3 in stock. → Needs an explicit decision: auto-offer partial dispatch + backorder the remainder, or escalate. **Not yet designed — added to this spec by Product Lead review, not previously covered.** Recommend: auto-offer partial fulfilment as a LOW-confidence draft (still human-reviewable under the exception model) rather than silently confirming the full order or blocking on escalation.
6. **Duplicate contact across channels.** Same buyer messages via WhatsApp and later emails. → `contacts.channels` (JSONB) already models this; needs explicit test coverage so it doesn't silently misroute reply channel or split conversation history.
7. **Angry / urgent customer.** Sentiment-driven escalation. → Important for trust, lower frequency than 1–3; a risk-flag input into the approve-by-exception model in §2, not a separate pipeline.

**Explicitly deprioritised for this pass:** multi-language handling (Gujarati/Hindi/English mixed messages) is real for this market but is a translation-quality problem, not an approval-logic problem — don't let it block the approval redesign above.

---

## 4. Current build status

Live and tested (308 Vitest tests as of 2026-06-30 — always confirm current count with `npm test` before treating this as current):
- Three-channel ingestion (WhatsApp dual-path, email, forms) → one AI pipeline
- Claude Haiku triage → structured JSON (Rule #2) → Claude Sonnet draft, with live catalogue/stock context injected
- Auto-reply gate (pre-redesign state described in §2), escalation + outcome tracking, sales-rep handoff
- Catalogue (`products` + append-only `stock_movements` ledger), CSV import
- Contact entity model (multi-channel person record)
- Quote → invoice pipeline, branded PDF generation
- Multi-tenant Supabase RLS, employee/team accounts (existing users only — see gap below)
- Stripe billing (test mode)
- Monday 8am digest email

Known gaps (tracked in `OPEN_TASKS.md`, not re-derived here — check that file for current priority order):
- Auth hardening: `DEV_BYPASS_AUTH=true`, tenant scoping via caller-controlled `x-tenant-id` header rather than a verified JWT session — **Security Lead veto, blocks any paying client** (see [architecture.md](architecture.md) §5).
- Employee invite for *new* (not-yet-signed-up) users — blocked on `SUPABASE_SERVICE_ROLE_KEY`.
- pgvector semantic catalogue match — blocked on an embeddings key; keyword match is the current fallback.
- Encrypted third-party credential storage (Supabase Vault, not JSONB) — required before any paying client.

---

## 5. Pricing

**Flag, not a decision:** three different pricing tables currently exist in the repo (`PRODUCT_STRATEGY.md`: £35/£99/£249/£499; `SESSION_1_FOUNDATION.md`: £49/£149/£399; `ROADMAP.md`: $49/$149/$399/$799 with different currency). This is Revenue Lead's domain to reconcile, not something to silently pick a winner on here. Recommend a short pass with Revenue Lead to publish one canonical table and retire the other two before this doc is shared externally.

---

## 6. Cut list (standing, do not re-propose without a named client asking)

WhatsApp broadcast campaigns (ban risk), pipeline kanban view, vanity-metric analytics, multi-currency, invoice accounting (P&L/tax — invoices are a sales tool, not bookkeeping), mobile PWA, CRM integrations (HubSpot/Salesforce), Instagram/Facebook DMs (GDPR consent review required first), website chat widget, AI-learned channel weighting.

Product Lead retains veto over reviving any of these without validated client signal.
