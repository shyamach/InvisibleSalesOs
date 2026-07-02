# Invisible Sales OS — Vision

_Last updated: 2026-07-01_

## The problem: The Lala Company Problem

A UK South Asian wholesale/distribution SME ("Lala company") runs like this today:

1. Customer sends WhatsApp: *"Bhai, 200 boxes protein powder chahiye, urgent"*
2. Sales rep forwards to the owner on WhatsApp
3. Owner checks stock mentally, on paper, or in Tally
4. Owner replies with a price from memory or an Excel sheet
5. Customer agrees
6. Owner tells the accountant to raise an invoice
7. Accountant re-enters everything into Tally by hand
8. Invoice is sent as a WhatsApp photo
9. Payment is chased manually, weeks later
10. Nobody has a record of what was promised. No pipeline visibility. No performance data.

**Every step leaks revenue.** Leads get lost. Follow-ups don't happen. Invoices go out late. Payments get missed. The owner *is* the operating system — and the business cannot scale past what one person can hold in their head.

## Vision statement

> **From first message to paid invoice — automated by default, human only when it matters.**

This is a deliberate revision from the product's original framing ("always human-approved"). Making every reply wait for a human doesn't remove the owner's workload — it just relabels it as a queue. See [product.md](product.md) for why, and what replaces it.

Invisible Sales OS is a Revenue Intelligence Platform, not a chatbot. It:
- Ingests leads from every channel a Lala business actually uses — WhatsApp, email, web forms — with more sources (Tally, PDF, image, voice) on the roadmap.
- Triages, scores, and drafts replies in the company's own voice, aware of live catalogue and stock.
- Sends routine replies automatically; escalates to a human only when the situation genuinely calls for judgment (price negotiation, high-value order, angry customer, out-of-stock).
- Converts an agreed deal into a quote, then an invoice, without anyone re-typing anything into Tally or Excel.
- Gives the owner one screen that shows the entire pipeline, live.

## Market position

Meta's free Business Agent (launched June 2026) is a chatbot: it answers questions and books appointments. That is not what a Lala business owner is short on — they're short on **deals closed and money collected**.

| Meta Business Agent | Invisible Sales OS |
|---|---|
| Generic responses | Brand DNA — your voice, your catalogue, your pricing |
| WhatsApp only | WhatsApp + Email + forms today; Tally, PDF, image, voice next |
| Auto-sends with no owner control | Automated by default, escalates the moments that need a human |
| No invoicing | Quote → invoice pipeline built in |
| Data goes to Meta | Data owned by the business, in their own Supabase project |
| Free, generic | Priced for SME, deeply personalised to their catalogue and voice |
| Answers customers | **Closes customers and collects payment** |

**Positioning statement:** *"Meta's agent answers your customers. Invisible Sales OS closes them."*

## Target customer

**Primary:** UK South Asian wholesale/distribution SMEs — textile distributors, supplement wholesalers, food importers, electronics distributors. £500K–£10M annual revenue, 2–20 person teams, WhatsApp-native, Tally or Excel for accounting. Pain: lost leads, mismanaged orders, delayed invoicing, zero pipeline visibility.

**Secondary:** India / UAE / Singapore SMEs, same profile — India needs GST compliance, UAE needs multi-currency and Arabic support. Not built yet; do not build ahead of a named client.

**Tertiary:** Accountancy/CA firms and business consultants who serve Lala companies, as a white-label/reseller channel.

## The moat

1. **Deep channel + workflow fit** — designed around how these businesses actually operate (WhatsApp-first, trust-driven, price-sensitive), not adapted from a generic Western SaaS template.
2. **Brand DNA that compounds** — the AI learns a specific company's voice, pricing logic, and customer relationships over time. Harder to rip out the longer they stay.
3. **Full pipeline ownership** — no competitor takes a WhatsApp message through triage → approved/auto reply → quote → invoice → payment in one product. (Tally sync is on the roadmap and would deepen this further — see [product.md](product.md) cut list for current status.)
4. **Data network effect** — every interaction trains the AI on that business's own patterns.

## GTM, in brief

CEO (Shyama) is the primary GTM channel via her personal network in the Lala market — zero CAC at launch. Sequence: **auth hardening → full product design → GTM → first client.** Design and security are a pre-GTM gate, not a post-revenue luxury. Full phased GTM plan lives in `PRODUCT_STRATEGY.md`; this file is the durable "why," that file has the sequencing detail and is expected to change faster than this one.

## Standing constraints on this vision

- UK launch, GBP only. Re-evaluate multi-currency at ~10 paying clients.
- No paying client until the Security Lead's pre-launch checklist clears (see [architecture.md](architecture.md) and `OPEN_TASKS.md` §5).
- Feature scope is gated by the Product Lead's cut list (see [product.md](product.md)) — no re-litigating cut features without a named client asking for them by name.
