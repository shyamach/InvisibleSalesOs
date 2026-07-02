# Generic Commercial Object — Conceptual Schema

_Last updated: 2026-07-02. Conceptual schema only. **No migration accompanies this document — Database Lead's standing rule.** This defines the shape of the Normalised Commercial Object and its companion Decision Object referenced in `../architecture.md` §5.1-§5.2 and `../product.md` §3. It will inform a JSONB envelope on existing tables or a new table, decided during `../architecture.md` §6 Block 9 — not decided here._

---

## Purpose

Every channel (WhatsApp, email, form, and future adapters) produces a differently-shaped raw payload. Before any specialist role or the Orchestrator reasons about a message, it needs one consistent shape — this document defines that shape conceptually, field by field, so `../architecture.md` §6 Block 9's implementation has something concrete to build against.

## Raw input

- `raw_text` — the message content as received, unmodified
- `raw_payload_ref` — pointer to the original channel payload (not inlined here — keeps this object lean; see `LEARNING_MEMORY_ARCHITECTURE.md` on why raw content gets special handling)
- `received_at` — timestamp

## Channel metadata

- `channel` — `whatsapp` / `email` / `form` / future adapters
- `source_address` — the customer's channel-specific identifier (phone/email/form-session)
- `reply_channel_hint` — any explicit channel preference stated in-message ("email me instead")
- `thread_ref` — link to the ongoing conversation thread, if one exists

## Conversation control fields

- `throttle_state` — `ACTIVE_PROCESSING` / `BUFFERING` / `SLEEPING` / `COOLDOWN` / `ARCHIVED_NOISE` / `ESCALATION_HOLD` (full definitions in `CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md`)
- `burst_id` — groups messages suppressed/merged as part of one burst, for audit purposes
- `meaningful_delta` — boolean, did this message add new information vs. the last processed one

## Signal classification

- `signal_category` — one of the 10 categories in `../product.md` §5
- `classification_confidence` — 0-1
- `weak_intent_flag` — boolean
- `sentiment` — neutral / negative / urgent (distinct dimensions, not conflated — see `../USE_CASE_TESTS.md` #21-22)

## Customer identity

- `contact_id` — resolved `contacts` row, if matched
- `identity_confidence` — how sure the match is
- `is_new_contact` — boolean
- `customer_score` — a learning-derived signal, never a service-gating one (`../USE_CASE_TESTS.md` #29)

## Company identity

- `company_ref` — if the business model distinguishes company from individual contact (future — not required for MVP's single-contact model)

## Product requests

- `requested_products[]` — array of `{ raw_mention, matched_product_id, match_confidence, ambiguous_candidates[] }`

## Quantities

- `requested_quantities[]` — parallel to `requested_products[]`, `{ product_ref, quantity, unit }`

## Delivery / timeline

- `requested_delivery_window` — free text + any structured date extracted
- `urgency_flag` — boolean, distinct from sentiment (see above)

## Commercial intent

- `intent_type` — mirrors `signal_category` where relevant, but can be more specific once normalised (e.g. `reorder`, `new_order`, `price_enquiry`, `stock_enquiry`, `negotiation`, `quote_followup`)

## Stock / pricing context (populated by specialist roles, not the ingestion step)

- `stock_check_result` — per requested product, at time of check (re-checked again at commitment time — see `../USE_CASE_TESTS.md` #18, #25)
- `pricing_result` — per requested product, standard tiered price

## Discount / promo eligibility

- `discount_eligibility` — record-only fields in MVP: `eligible_promo_id`, `eligibility_basis`, `applied` (always `false` in MVP), `surfaced_to_rep` (boolean)

## Risk flags

- `risk_flags[]` — from the fixed vocabulary: `negotiation`, `product_ambiguous`, `stock_race`, `partial_stock`, `payment_risk`, `sentiment_negative`, `urgency`, `new_customer`, `high_value`, `identity_unresolved`, `discount_ambiguous`, `billing_details_incomplete`

## AI confidence

- `orchestrator_confidence` — the final decision's confidence, distinct from any individual specialist role's confidence

## Specialist agent outputs

- `agent_outputs[]` — array of the output-contract objects defined in `SPECIALIST_AGENT_ARCHITECTURE.md`, one per role that ran

## Next best action

- `proposed_action` — from the allowed-actions vocabulary (`../product.md` §12)
- `gate_decision` — approved / blocked, plus `tenant_scope_verified` and `pii_sensitivity` (Security Lead's mandated fields)

## Escalation reason

- `escalation_reason` — free text + a structured reason code, populated only when `proposed_action` resolves to escalation

## Action payload

- `action_payload` — whatever the executed action needs (draft text, quote line items, escalation briefing) — shape varies by `proposed_action`, not a single fixed structure

## Decision explanation

- `decision_reason` — the one-line, owner-facing explanation required by Customer Success's condition (`../product.md` §9, §12). This is not optional metadata — it's a required field precisely because it's shown to the business owner.

## Learning signals

- `learning_signals[]` — from the fixed vocabulary in `../product.md` §11, written by the Learning & Memory role after every decision

## Audit metadata

- `decision_id` — unique per decision, links to the Decision Audit Log row (`../architecture.md` §6 Block 13)
- `tenant_id` — required, non-null, RLS-scoped (Database Lead's standing rule — no exceptions)
- `orchestrator_version` — which version of the decision logic produced this, for debugging drift over time

---

## What this document is not

Not a migration. Not a finalised column list with types — that's Block 9's implementation task, reviewed by Database Lead before any schema is drafted. This document exists so that task has a complete conceptual target, not a blank page.
