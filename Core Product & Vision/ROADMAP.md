# Invisible Sales OS — Decision Brain Roadmap

_Last updated: 2026-07-02. Supersedes the earlier Sprint 0-5 roadmap (2026-06-26), which described a now-superseded "AI inbox" framing. Sequencing here is sprint-level; the authoritative, board-approved build order is `architecture.md` §6's Block 0-16 — where the two disagree, the Block order wins. Reviewed by the full board (all six GO WITH CONDITIONS)._

---

## Sprint 0 — Current baseline

Already built and tested (308 tests / 27 files as of 2026-07-02): three-channel ingestion (WhatsApp dual-path, email, forms), Claude Haiku triage, catalogue context injection, Claude Sonnet draft generation, an auto-reply gate (not yet matching its own decided spec — see `product.md` §1's engineering reality check), escalation + outcome tracking, catalogue/stock ledger, CSV import, contact entity model, quote → invoice, multi-tenant Supabase RLS, Stripe billing (test mode), Monday digest. This baseline is preserved throughout everything below — the Decision Brain formalises it, it does not replace it.

---

## Foundation — must complete before Sprint 3 begins (architecture.md §6, Blocks 0-1)

Not a numbered sprint because it isn't Decision Brain work — it's the prerequisite the board made non-negotiable:

- **Block 0 — Data-safety net.** `failed_ingestions` table, atomic stock-movement update, sweeper claim-lock. Database Lead's hard gate on all Decision Brain schema/code work. **Status: `failed_ingestions` table applied 2026-07-02 (migration `20260702224053`); atomic stock-movement update and sweeper claim-lock still unbuilt — Block 0 not yet complete.**
- **Block 1 — Tenant-scoping auth fix.** `requireAuth`/`req.tenantId` wired onto the currently-unprotected controllers. Security Lead's hard gate on the Decision Orchestrator (Sprint 7) and anything that executes.
- Blocks 2-5 (wwebjs process isolation, circuit breakers, per-subsystem health, IMAP + cron extraction) can proceed in parallel with Sprints 1-2 below, since they don't touch the Decision Brain layer — see `architecture.md` §6.

---

## Sprint 1 — Product/architecture alignment

Update `vision.md`, `product.md`, `architecture.md` to the Decision Brain direction (this pass). Define the MVP boundary, the specialist-role model (collapsed to real implementation stages, not 15 runtime agents — `product.md` §4), the generic commercial object shape, and the learning architecture. Docs-only — no behaviour change. **Status: done, this document is part of it.**

## Sprint 2 — Test-first decision scenarios

Expand `USE_CASE_TESTS.md` with fixtures for weak intent, spam bursts, commercial intent, negotiation, stock risk, discount learning, and quote/invoice readiness (the 30 scenarios in that document). No production behaviour change — these are the acceptance criteria Sprints 3+ get built against.

## Sprint 3 — Conversation Throttle & Signal Buffer (`architecture.md` Block 7)

Burst detection, duplicate suppression, meaningful-delta detection, weak-intent cooldown, sleep/wake states. Token-saving by design — see `docs/CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md`. Pure/deterministic, no LLM call added. *Depends on: Block 0.*

## Sprint 4 — Signal Classifier + Intent Discovery (`architecture.md` Block 8)

Extends the existing Haiku triage call's schema with the 10 signal categories (`product.md` §5). The "Hi" weak-intent flow. Clarification before escalation. No new LLM call.

## Sprint 5 — Generic Commercial Object + decision output shape (`architecture.md` Block 9)

Channel-agnostic normalised request shape, decision output shape, audit fields, learning-signal fields — see `docs/GENERIC_COMMERCIAL_SCHEMA.md`. Schema/design only, no migration.

## Sprint 6 — Specialist decision functions (`architecture.md` Block 10)

Product/customer/inventory/pricing/payment/discount/policy context assembly — implemented as parallel plain async functions against existing tables, not separate LLM-calling agents (per Product Lead's and CTO/AI's explicit collapse instruction). Structured output contracts, including the `tenant_scope_verified`/`pii_sensitivity` fields Security Lead required from day one.

## Sprint 7 — Decision Orchestrator (`architecture.md` Block 11)

Combines specialist outputs, extends `lib/autoReply.js`'s gate into the full Risk + Confidence Gate, determines next-best-action. **Hard gate: does not begin until Block 1 (tenant-scoping auth fix) is verified in production.** This sprint is also where `lib/autoReply.js` is finally brought into compliance with its own already-decided approve-by-exception spec.

## Sprint 8 — Decision Audit + Learning Events (`architecture.md` Blocks 13-14)

Decision log design, learning event design — rep edits, manual discounts, promo usage, quote outcomes, escalation validity. **Requires explicit Database Lead and Security Lead sign-off on the schema's PII/redaction/retention handling before any migration runs** — this table captures full commercial context on every decision, a larger and more continuous PII surface than anything in the product today.

## Sprint 9 — Discount/promo intelligence (`architecture.md` Block 15)

Record-only: manual discounts, customer score signals, promo usage and outcomes. **Explicitly not included in this sprint:** AI-suggested discounts or auto-applied promos — Revenue Lead's review made these separate, future GO decisions, not an assumed continuation of this sprint.

## Sprint 10 — Advanced commercial loops

Quote revision, quantity change, stock re-check before invoice (closing the gap named in `product.md` §5 use case 4), partial fulfilment (use case 5 — needs a product decision first, not just code), payment risk, duplicate customer across channels (use case 6).

---

## Later (Phase 2+, gated on named client demand or explicit dependency)

- Advanced channel adapters (`architecture.md` Block 16): website chat, voice/PDF/image ingestion, Instagram/Facebook (GDPR review required first)
- Industry Playbook specialist role (`product.md` §4, role #12) — needs real multi-tenant data to be worth building
- Advanced analytics
- Dynamic discounting (a separate future GO decision from Sprint 9's record-only scope)
- Multi-tenant production hardening beyond the Foundation section above
- Tally ERP sync — still cut, per `product.md` §16, until named client demand

---

## Explicitly not a sprint — pricing

Reconciling the three conflicting pricing tables across legacy docs is Revenue Lead's ongoing work, proceeding in parallel with this roadmap, not gating it — except that this roadmap's "decided" status for external positioning depends on it resolving. See `product.md` §17 and `PRODUCT_CHANGELOG.md`'s open flags.
