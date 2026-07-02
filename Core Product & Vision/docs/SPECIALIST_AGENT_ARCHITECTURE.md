# Specialist-Agent Architecture

_Last updated: 2026-07-02. Full architecture spec for the controlled specialist-agent pattern referenced in `../product.md` §4 and `../architecture.md` §5. Board-reviewed — see `../PRODUCT_CHANGELOG.md` for the full record. Read `DECISION_BRAIN_MVP.md` first for the overall shape; this document is the per-role detail._

---

## Orchestrator pattern

One Decision Orchestrator per message (`engine.js`, extended). It is the only component that assembles specialist outputs into a single next-best-action recommendation. It never executes anything itself — that's the Safe Action Engine's job, gated by the Risk + Confidence Gate. No specialist role calls another specialist role directly; every call happens through the Orchestrator. This is what "controlled" means in "controlled specialist-agent Decision Brain" — there is no agent-to-agent chaining, no autonomous loop, and no path by which a role's output reaches the outside world without passing through the Gate.

## Per-role specification

Each role below: **responsibility**, **input**, **output**, **mechanism** (deterministic/rules/DB/cheap-model/LLM), **when it runs**, **must never**, **fallback**, **learning signals**. `NEW`/`REFRAME` tags match `../product.md` §4 and `../architecture.md` §5.2.

### 1. Conversation Throttle & Signal Buffer — `NEW`
Responsibility: detect and hold rapid/duplicate/low-info bursts before anything else runs. Input: raw inbound message + recent message history for this contact/channel. Output: `release` (proceed) or `hold` (buffered/cooldown/sleep — see `CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md`). Mechanism: deterministic/rules. Runs: first, before the classifier. Must never: silently drop a message with no record. Fallback: if throttle state itself fails, process the message individually rather than lose it. Learning signals: `burst_suppressed`.

### 2. Signal Classification — `REFRAME` (extends `AI_Triage.js`)
Responsibility: classify the message into one of the 10 categories (`../product.md` §5). Input: message text + language + prior context. Output: category + priority + language + confidence. Mechanism: cheap model (existing Haiku call, extended schema — no new call). Runs: after throttle release. Must never: silently default to a category on low confidence — falls to `unknown_needs_clarification` instead. Fallback: classifier failure → dead-letter (`../architecture.md` §6 Block 0), never a crashed request. Learning signals: `spam_pattern_confirmed`, classification-accuracy signals from later corrections.

### 3. Intent Discovery — `REFRAME` (branch on #2's output)
Responsibility: when intent is weak or unknown, ask one clarifying question rather than escalate or ignore. Input: classifier output. Output: a clarification prompt, or a pass-through if intent is already clear. Mechanism: rules (which question to ask) + the existing draft LLM call to phrase it. Runs: immediately after classification, when needed. Must never: ask more than two clarifying rounds before deferring to the Gate. Fallback: unanswered clarification → no further nudge, thread stays open. Learning signals: `weak_intent_resolved`.

### 4. Normalisation / Generic Commercial Object — `NEW` (schema, not a service)
Responsibility: produce one channel-agnostic shape describing what's being asked, regardless of source channel. Input: classified message + any prior messages in the same commercial thread. Output: the object defined in `GENERIC_COMMERCIAL_SCHEMA.md`. Mechanism: schema/shape — assembled by the Orchestrator, not a separate call. Runs: after classification. Must never: lose channel-specific detail needed later (e.g. reply-to address) — those live in the object's channel-metadata fields. Fallback: incomplete object → downstream roles treat missing fields as unknown, not zero/false. Learning signals: none directly.

### 5. Product Intelligence — `REFRAME` (`lib/catalogueContext.js`)
Responsibility: match the request to real catalogue items. Input: commercial object's product-request field(s). Output: matched product(s), or ambiguity/no-match. Mechanism: DB lookup (keyword today, pgvector when unblocked — `../product.md` §6). Runs: parallel with roles 6-9 (§ `../architecture.md` §5.7). Must never: guess a match below a confidence threshold — returns ambiguous instead (`../USE_CASE_TESTS.md` #7). Fallback: lookup timeout → non-fatal, draft proceeds without it (existing pattern). Learning signals: `product_alias_confirmed`.

### 6. Customer Intelligence — `REFRAME` (`contacts` + `smart_leads` history)
Responsibility: resolve identity and pull relevant history. Input: contact identifiers (phone/email). Output: known/new, prior order history, preferred channel, customer-score signal. Mechanism: DB lookup. Runs: parallel with 5, 7-9. Must never: merge two genuinely different people on a weak match. Fallback: ambiguous identity → treat as new contact rather than guessing which existing one. Learning signals: `customer_conversion_quality`.

### 7. Inventory — `REFRAME` (`products` / `stock_movements`)
Responsibility: real-time stock check. Input: matched product(s) + requested quantity. Output: available/unavailable/partial + current quantity. Mechanism: DB lookup, must become an atomic re-check at the moment of commitment (`../architecture.md` §6 Block 0) — not just at initial reply time. Runs: parallel with 5-6, 8-9; **also re-run at quote-acceptance time** (`../USE_CASE_TESTS.md` #25). Must never: confirm stock that hasn't been freshly checked when a commitment is being made. Fallback: lookup failure → hold rather than guess. Learning signals: `stock_issue`.

### 8. Pricing — `REFRAME` (`products.price` + tenant rules)
Responsibility: determine standard price, including any quantity tiering. Input: matched product + quantity. Output: price, tier basis. Mechanism: DB/rules. Runs: parallel with 5-7, 9. Must never: apply a discount here — pricing returns the standard price only; discounting is role 10's job and is gated separately. Fallback: no tier match → flat price. Learning signals: none directly.

### 9. Payment/Account Risk — `NEW` (stub in MVP)
Responsibility: assess whether this customer/order carries payment or account risk. Input: customer identity, invoice history. Output: risk level, or `unknown` for a new contact (MVP default — no history exists to assess). Mechanism: DB/rules once real payment history accumulates; today, always returns `unknown`. Runs: parallel with 5-8. Must never: return "safe" by default — `unknown` is treated conservatively (`../USE_CASE_TESTS.md` #20). Fallback: n/a (the stub *is* the fallback). Learning signals: feeds forward once real data exists.

### 10. Discount & Promo Intelligence — `NEW`, record-only in MVP (Revenue Lead's hard gate)
Responsibility: check eligibility against pre-approved policy, and record manual discount/promo events. Input: order details, tenant promo rules, any manual rep action. Output (MVP): eligibility flag for internal/rep visibility only — never auto-applied, never AI-suggested to the customer. Mechanism: DB/rules. Runs: after 5-9's context is assembled. Must never: apply, suggest, or imply a discount to the customer in MVP. Fallback: none needed — MVP behaviour is uniformly conservative. Learning signals: `manual_discount_applied`, `promo_eligible_not_applied`, `promo_rejected`.

### 11. Tenant Policy — `REFRAME` (`tenants.auto_reply` config, extended)
Responsibility: hold and surface this tenant's specific thresholds and rules (order-value threshold, escalation sensitivity, tone). Input: tenant ID. Output: the policy object other roles read against. Mechanism: DB/rules. Runs: loaded once per message, referenced by multiple roles. Must never: apply a default policy value silently where a tenant hasn't configured one — surfaces as "using default X" in the audit log, not silent. Fallback: missing config → conservative default (favouring escalation, not auto-send). Learning signals: none directly.

### 12. Industry Playbook — `Phase 2+`, not MVP
Responsibility (future): pre-set behavioural templates per vertical (supplements, textiles, food import). Not built. Not scheduled — needs real multi-tenant data to be worth building (`../product.md` §16).

### 13. Risk & Confidence — `REFRAME` (extends `lib/autoReply.js`)
Responsibility: the Gate. Approves or blocks the Orchestrator's proposed action. Input: all specialist outputs + the Orchestrator's proposed next-best-action. Output: approve/block + `tenant_scope_verified` + `pii_sensitivity` (Security Lead's mandated fields, see the contract below). Mechanism: rules + optional AI for borderline confidence cases. Runs: after all specialist roles report. Must never: approve an action where `tenant_scope_verified` is false — no override exists. Fallback: uncertain → block, defer to escalation. Learning signals: feeds `escalation_valid`/`invalid` once outcomes are known.

### 14. Next-Best-Action — `REFRAME` (the Orchestrator's decision output)
Responsibility: given everything assembled, decide *what* to do (not whether it's allowed — that's role 13). Input: all specialist outputs. Output: one proposed action from the allowed-actions table (`../product.md` §12). Mechanism: deterministic given the inputs. Runs: before the Gate. Must never: propose an action outside the allowed list. Fallback: no clean match → propose "hold for review." Learning signals: none directly — the *outcome* of the chosen action is what's recorded.

### 15. Response/Execution — `REFRAME` (`responder.js` draft + `outbox.js`/`escalationService.js` dispatch)
Responsibility: draft the actual reply (if the action is a reply) and execute the approved action. Input: the Gate-approved action + full context. Output: sent message / generated quote / escalation with briefing / suppression, as applicable. Mechanism: LLM for drafting (existing Sonnet call — no new call), deterministic for dispatch. Runs: only after Gate approval. Must never: execute anything the Gate didn't approve. Fallback: dispatch failure → dead-letter, never a silent drop. Learning signals: `quote_outcome`, `invoice_generated`, etc., depending on the action.

### 16. Learning & Memory — `NEW` (extends `ai_learning`)
Responsibility: record every action, non-action, and suppression as a structured event. Input: the full decision record. Output: a `learning_events` row (`LEARNING_MEMORY_ARCHITECTURE.md`). Mechanism: structured writer, no model call. Runs: after every decision, regardless of outcome. Must never: block the commercial action if the write fails (best-effort, same pattern as existing Sheets backup). Fallback: write failure → logged, action itself is unaffected. Learning signals: this role *is* the learning-signal mechanism for every other role.

## Agent output contract

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

`tenant_scope_verified` and `pii_sensitivity` are Security Lead's binding condition, specified now, before any role exists in code, specifically so they never need retrofitting — see `../architecture.md` §5.4.

## Parallelisation

Roles 5-9 (Product, Customer, Inventory, Pricing, Payment/Risk) run as parallel plain async functions once the Normalised Commercial Object exists. Roles 10-11 (Discount, Tenant Policy) and 13-16 (Risk/Gate, Next-Best-Action, Response/Execution, Learning) run sequentially after, since each depends on the prior step's output. Full detail: `../architecture.md` §5.7.

---

## Worked example 1 — full commercial request

**Input:** *"Hi need 200 boxes protein powder urgent, best price?"* (WhatsApp, new-ish contact with one prior small order)

1. Throttle: single message, releases immediately.
2. Classifier: `commercial_intent` + urgency signal, HIGH priority (large quantity).
3. Intent Discovery: not needed — intent is clear.
4. Normalisation: commercial object built — product: "protein powder" (ambiguous — multiple SKUs), quantity: 200, urgency: yes, pricing ask: "best price" (negotiation signal).
5. Parallel context: Product returns 3 candidate SKUs (ambiguous); Customer returns one prior small order; Inventory checks all 3 candidates; Pricing returns standard tiered price for each; Payment/Risk returns "low history, but not unknown" given the one prior order.
6. Discount/Tenant Policy: "best price" phrasing is flagged as a negotiation signal by role 10 (record/check only).
7. Risk & Confidence Gate: two risk flags fire — `product_ambiguous` and `negotiation`. Per `../product.md` §9 and `../USE_CASE_TESTS.md` #12, negotiation always escalates regardless of other factors. Gate blocks auto-send, `tenant_scope_verified` would need to be true in production (blocked entirely pre-Block-1 today).
8. Next-Best-Action: hold for review, with product ambiguity noted for the rep to resolve alongside the price conversation.
9. Response/Execution: holding reply sent to customer; full briefing (candidate products, quantity, customer history, negotiation flag) sent to a rep.
10. Learning: `escalation_valid` recorded once the rep's outcome is known; `product_alias_confirmed` recorded once the rep resolves which SKU was meant.

## Worked example 2 — spam/burst scenario

**Input:** 200× "Hi" from the same number in 5 minutes.

1. Throttle: message 1 releases normally (weak intent, gets one clarifying reply). Messages 2-3 are recognised as a repeat pattern; from message ~4 onward, throttle enters `BUFFERING` then `SLEEPING` (see `CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md`).
2. Classifier: not invoked for the suppressed messages — this is the entire point of the throttle running first.
3. No commercial object, no specialist roles invoked, no Gate decision needed for messages 2-200.
4. Response/Execution: exactly one reply sent (from message 1's weak-intent flow), nothing further.
5. Learning: `burst_suppressed` recorded with a count (199), visible to the tenant as a daily summary per Customer Success's condition — never silent.

## Worked example 3 — discount scenario

**Input:** A known repeat customer messages *"same as always, what's the best you can do?"*

1. Throttle: releases.
2. Classifier: `commercial_intent`, negotiation signal present ("best you can do").
3. Normalisation: commercial object references a prior order pattern ("same as always").
4. Customer Intelligence: finds prior order history, including one instance where a rep manually applied a 5% discount on a large order.
5. Discount/Promo Intelligence (record-only): surfaces the historical discount as a **note for the rep**, not an auto-applied number — MVP does not let "same as always" silently reapply a past discount (`../USE_CASE_TESTS.md` #10).
6. Risk & Confidence Gate: `negotiation` flag fires → always escalates, per §9.
7. Response/Execution: holding reply to the customer; rep briefing includes the historical discount as context, explicitly not a pre-approved number to just repeat.
8. Learning: if the rep applies a discount again, `manual_discount_applied` is recorded, feeding future pattern visibility — never automatic reapplication.
