# Invisible Sales OS — Product Spec

_Last updated: 2026-07-02. States the current, decided product only — for how it got here and why, see `PRODUCT_CHANGELOG.md`. Companion to [vision.md](vision.md) (the why) and [architecture.md](architecture.md) (the how)._

---

## 1. What we're actually building

An AI-run sales inbox for UK South Asian wholesale/distribution SMEs. A message arrives on WhatsApp, email, or a web form; the product decides — automatically, in seconds — whether to answer it, and answers it in the business's own voice with real prices and real stock levels. It only stops for a human at the handful of moments that genuinely need judgment: a price negotiation, an unusually large first order, stock that's run out, or a customer who's upset. Every agreed deal becomes a quote, then an invoice, without anyone re-typing anything into Tally or Excel.

It is not a chatbot and not a generic auto-responder. It is the layer that currently only exists in the owner's head — decide who gets an instant answer, who needs a human, what's actually in stock, and what to bill — running automatically instead.

## 2. The problem, concretely

A Lala business owner gets 50–200 WhatsApp messages a day about orders, prices, and stock. Today, every one of them either interrupts the owner directly or gets forwarded to a rep who checks stock from memory or a spreadsheet and replies whenever they get to it. Leads get lost in the volume. Follow-ups don't happen. Invoices go out late, often as a WhatsApp photo of a handwritten note. Nobody has a record of what was promised. See [vision.md](vision.md) for the full framing and market position — this section exists only to anchor what follows in the actual pain, not an abstraction of it.

## 3. Ingestion channels

Three channels are live today, all first-class, all feeding one pipeline:

| Channel | Path | Status |
|---|---|---|
| **WhatsApp** | Meta Cloud API webhook (production) + whatsapp-web.js live listener (dev / `@lid` fallback) | Live |
| **Email** | IMAP polling in (`lib/emailListener.js`, 60s poll), Resend for outbound (`lib/emailSend.js`) | Live, co-equal channel — same triage/draft/approval pipeline as WhatsApp |
| **Web forms** | Generic `POST /webhook/lead` (Tally, Typeform, custom forms), Zod-validated, rate-limited | Live |

Not yet built (do not start without the gates in §7): Tally ERP sync, image/PDF/voice-note ingestion, Instagram/Messenger DMs, website chat widget.

Every channel normalises into the same lead shape before entering the AI pipeline — see [architecture.md](architecture.md) for the full flow and why each channel is a structurally separate entry point.

## 4. How a message is actually handled

1. **Triage** (Claude Haiku) — classifies priority (HIGH/MEDIUM/LOW), language, and intent from the raw message.
2. **Catalogue context** — live price and stock are pulled from `products`/`stock_movements` and injected into the draft, so the reply is never generic.
3. **Draft generation** (Claude Sonnet) — a reply is written in the business's own voice (Brand DNA).
4. **The decision gate** (`lib/autoReply.js`) — this is the current, decided design, not a work-in-progress:
   - **LOW** → sends automatically. No human touch.
   - **MEDIUM** → sends automatically **unless** a risk flag fires (price negotiation, stock ambiguity, first-time customer, order value above a tenant-configurable threshold, negative sentiment) — in which case it holds for human review. This is an *exception inbox*, not an approval queue.
   - **HIGH** → always manual. No exceptions, ever.
   - A 60–120 second undo window sits under every auto-sent message as a safety net.
5. **Escalation** — out-of-stock or price-negotiation situations route to a sales rep with a briefing, tracked to outcome (converted/rejected/stalled).
6. **Quote → invoice** — an agreed deal becomes a quote, then a branded PDF invoice, on one click.

This design exists because mandatory per-message approval doesn't remove the owner's workload, it just relabels it as a queue — full reasoning in `PRODUCT_CHANGELOG.md`'s 2026-07-01 entry.

## 5. Complex use cases the product must actually handle

The product's value is proven or disproven at these moments, not on the happy path. In build priority order:

1. **Out-of-stock at time of reply.** Routes to escalation (`lib/escalation.js`) — never auto-confirms a sale the business can't fulfil.
2. **Price negotiation.** Always escalates, regardless of triage priority — negotiation is judgment, not lookup.
3. **High-value first-time order.** New contact + order value above threshold → treated as HIGH regardless of triage confidence.
4. **Stock changing mid-conversation.** Customer confirms an order, but stock sells out via another channel before dispatch. Needs an explicit re-check against `stock_movements` immediately before quote/invoice generation, not just at initial reply time. **Currently a gap** — see `architecture.md` §5 Block 0 for the concurrency fix this depends on.
5. **Partial / split fulfillment.** Order exceeds available stock. **Not yet designed.** Recommendation: auto-offer partial dispatch + backorder as a reviewable draft, rather than silently confirming the full order or blindly escalating.
6. **Duplicate contact across channels.** Same buyer via WhatsApp and email. `contacts.channels` (JSONB) already models this; needs explicit test coverage so reply-channel or history don't silently split — see `USE_CASE_TESTS.md`.
7. **Angry / urgent customer.** Sentiment-driven escalation — a risk-flag input into the decision gate (§4), not a separate pipeline.

**Explicitly deprioritised:** multi-language handling (Gujarati/Hindi/English mixed messages) is real for this market but is a translation-quality problem, not an approval-logic problem.

## 6. Current build status

Live and tested (confirm current count with `npm test` before treating a number here as current):
- Three-channel ingestion (WhatsApp dual-path, email, forms) → one AI pipeline
- Claude Haiku triage → structured JSON → Claude Sonnet draft, with live catalogue/stock context
- Decision gate (§4), escalation + outcome tracking, sales-rep handoff
- Catalogue (`products` + append-only `stock_movements` ledger), CSV import
- Contact entity model (multi-channel person record)
- Quote → invoice pipeline, branded PDF generation
- Multi-tenant Supabase RLS, employee/team accounts (existing users only — see gap below)
- Stripe billing (test mode)
- Monday 8am digest email

Known gaps (tracked in `OPEN_TASKS.md`, current priority order lives there, not here):
- Auth hardening: `DEV_BYPASS_AUTH=true`, tenant scoping via caller-controlled `x-tenant-id` header rather than verified JWT — **Security Lead veto, blocks any paying client** (see `architecture.md` §6).
- Employee invite for new (not-yet-signed-up) users — blocked on `SUPABASE_SERVICE_ROLE_KEY`.
- pgvector semantic catalogue match — blocked on an embeddings key; keyword match is the fallback.
- Encrypted third-party credential storage (Supabase Vault, not JSONB) — required before any paying client.
- Architecture is being rebuilt block-by-block per `architecture.md` §5 — until Block 0 lands, the concurrency risks named in use cases 4 and 6 above are live, not hypothetical.

## 7. Cut list (standing — do not re-propose without a named client asking)

WhatsApp broadcast campaigns (ban risk), pipeline kanban view, vanity-metric analytics, multi-currency, invoice accounting (P&L/tax — invoices are a sales tool, not bookkeeping), mobile PWA, CRM integrations (HubSpot/Salesforce), Instagram/Facebook DMs (GDPR consent review required first), website chat widget, AI-learned channel weighting.

Product Lead retains veto over reviving any of these without validated client signal.

## 8. Pricing — open, not decided here

Three different pricing tables exist across legacy docs and disagree with each other. This is Revenue Lead's domain to reconcile — see `PRODUCT_CHANGELOG.md`'s open flags. Do not treat any number currently in the repo as final.
