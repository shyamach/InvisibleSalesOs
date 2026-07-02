# Learning & Memory Architecture

_Last updated: 2026-07-02. Full spec for the Learning/Memory Engine referenced in `../architecture.md` §5.1 and `../product.md` §11. **Conceptual + design only — no migration accompanies this document.** Database Lead's condition: minimal v1 shape (append-only `decision_audit_log` + `learning_events`, no materialised memory tables yet) requires explicit Database Lead **and** Security Lead sign-off before any migration is drafted (`../architecture.md` §6 Block 13-14). This document is what that review will be conducted against._

---

## Layers

**Raw conversation log** — the existing `smart_interactions` table; unchanged by this design.

**Interaction timeline** — the existing per-lead activity view; unchanged.

**Decision log** (`decision_audit_log`, new) — one row per decision the Orchestrator made, including non-actions and suppressions. This is the audit trail for "why did the system do (or not do) X."

**Learning events** (`learning_events`, new) — one row per outcome signal: a rep edit, a manual discount, a promo outcome, a quote/invoice result, an escalation's validity once known. This is the input to future scoring/pattern-recognition — not itself a scoring system in MVP.

**Customer memory, product memory, company/client DNA memory** — **not built in MVP.** These are read-models *derived from* the append-only decision log and learning events, once real query patterns are proven — not separate tables built speculatively now (Database Lead's explicit scope cut).

**Industry playbooks** — Phase 2+, not MVP (`../product.md` §16).

**Discount/promo memory** — covered by `learning_events`' `manual_discount_applied` / `promo_eligible_not_applied` / `promo_rejected` signal types; no separate table in MVP.

**Outcome memory** — covered by `learning_events`' `quote_outcome` / `invoice_generated` signal types.

**Customer profile score** — a derived value from `learning_events`, computed on read, not stored as a mutable running total in MVP (avoids the class of bug where a stored score drifts from its inputs).

## What to retrieve for AI, and what not to

**Retrieve:** structured summaries — recent classification history for this contact, the specialist context object for the current message, relevant prior `learning_events` (e.g. "this contact had a manual discount applied once, on order X").

**Do not retrieve:** the full raw chat history of a contact, replayed into a prompt. This is an explicit, board-relevant design decision, not an oversight.

## Why not blind full-chat-history prompting

Three reasons, all load-bearing:
1. **Cost** — a long-running customer relationship accumulates hundreds of messages; replaying all of them into every future prompt scales token cost with relationship length, which is exactly backwards (a good customer should be *cheaper* to serve over time as more is known, not more expensive).
2. **Signal-to-noise** — most of a raw chat history is not decision-relevant (pleasantries, resolved back-and-forth). Structured learning events *are* the distilled, decision-relevant signal; re-deriving it from raw text every time is redundant and can drift in interpretation between calls.
3. **PII exposure surface** — every additional place raw commercial conversation content is pulled into a live prompt is another place it could leak (into logs, into a provider's context, into a debugging session). Structured, redacted learning events minimise this surface deliberately.

## Tenant isolation

Every row in `decision_audit_log` and `learning_events` is `tenant_id`-scoped with RLS, following the exact convention already used on `contacts`/`products`/`escalations` (Database Lead's condition — structural isolation, not application-layer discipline alone). No query path exists, or is ever to be built, that reads across tenants for learning purposes. This is stricter than typical SaaS multi-tenancy because the whole point of "tenant-shaped intelligence" (`../vision.md` moat #2) collapses if Tenant A's patterns leak into Tenant B's decisioning, even accidentally.

## Privacy rules

- `decision_audit_log` captures full commercial context on **every** decision, not just failures — a materially larger and more continuous PII surface than the existing `failed_ingestions` table (Security Lead + Database Lead's shared finding). Raw message content referenced by a decision is stored via `raw_payload_ref` (pointer, likely to Supabase Storage) rather than inlined, keeping the audit table itself lower-sensitivity — mirrors the pattern in `../docs/GENERIC_COMMERCIAL_SCHEMA.md`.
- Every row carries `pii_sensitivity` (`none`/`standard`/`sensitive`) so retention and redaction policy can be applied per-row, not uniformly.
- Retention window: to be set by Database Lead + Security Lead during Block 13-14's review — not decided in this document.

## Cross-tenant learning restrictions

None permitted, in any form, at any point on the current roadmap. If this is ever revisited (e.g. anonymised, aggregate industry benchmarking as a future paid feature), it requires its own explicit board review — it is not an implicit future unlock of anything in this document.

## Example learning events

`manual_discount_applied` · `ai_reply_edited` · `quote_accepted` · `quote_rejected` · `invoice_paid` · `payment_overdue` · `escalation_validated` · `escalation_rejected` · `spam_burst_detected` · `product_alias_confirmed`

Each event: `tenant_id`, `event_type`, `entity_ref` (the lead/quote/invoice/escalation it relates to), `delta` (what changed, JSONB), `created_at`. Minimal v1 shape per Database Lead's condition — no aggregation or scoring columns in the table itself; those are computed on read from the event stream.
