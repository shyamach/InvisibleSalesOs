# Decision Brain — MVP Specification

_Last updated: 2026-07-02. Full MVP spec for the Decision Brain direction. Companion to `../product.md` (product-level summary) and `../architecture.md` (build sequencing). Board-reviewed, GO WITH CONDITIONS from all six roles — conditions are enforced inline here, not repeated as a separate list; see `../PRODUCT_CHANGELOG.md` for the full board record._

---

## Purpose

To define, precisely enough to build test-first, what "the Decision Brain" means as a shippable MVP — not the full ambition in `../vision.md`, but the smallest version that is genuinely a decision engine rather than a chatbot with extra steps.

## Problem solved

A Lala business owner currently *is* the decision engine: every inbound message gets judged by a human, using judgment that lives only in that person's head. This doesn't scale past what one person can process, and it doesn't survive them being busy, asleep, or on holiday. The MVP's job is to take over the judgment that's genuinely routine (most of it) and surface, clearly, the judgment that genuinely isn't (a minority of it) — not to answer messages faster.

## Why this is not a chatbot

A chatbot's job is to produce a reply. This system's job is to decide what should happen next, and "send a reply" is one of several possible outcomes alongside "hold for a person," "ask a clarifying question," "suppress as noise," "generate a quote," or "do nothing and wait." A chatbot has no concept of declining to answer, checking real inventory before promising it, or recognising that a message is 1 of 200 near-identical ones. This system's value is entirely in the deciding, not the drafting — drafting (the LLM call that writes the words) is the smallest, most replaceable part of the pipeline.

## MVP flow

```
Any channel input
  → Conversation Throttle & Signal Buffer
  → Signal Classifier
  → Intent Discovery
  → Normalised Commercial Object
  → Controlled Specialist-Agent Decision Brain
  → Risk + Confidence Gate
  → Safe Action Engine
  → Decision Audit Log
  → Memory / Learning Engine
  → Escalate only if needed
```

Full stage-by-stage detail: `../architecture.md` §5.

## Principles (non-negotiable, board-conditioned)

1. **Channels are adapters.** No channel-specific decisioning logic — a WhatsApp message and an email carrying the same request must reach the same decision.
2. **The Decision Brain is the product.** Anything that isn't judgment (channel plumbing, PDF rendering, UI) is infrastructure around the product, not the product.
3. **Escalation is the last resort.** See `../product.md` §9 for the exact ordering of what's tried before a human is pulled in.
4. **Every action creates memory** — including non-actions and suppressions. See `LEARNING_MEMORY_ARCHITECTURE.md`.
5. **Not every "agent" is a model call.** Most of the 15 documented specialist roles (`SPECIALIST_AGENT_ARCHITECTURE.md`) are plain deterministic functions or DB lookups. Exactly two LLM calls exist per message today (classification, drafting) and the MVP adds none — CTO/AI and Revenue Lead's shared condition.
6. **Sub-agents advise, never act.** Only the Safe Action Engine executes anything externally visible.

## Specialist-agent map

Index only — full detail in `SPECIALIST_AGENT_ARCHITECTURE.md`. Sixteen documented roles (the original 15 plus Learning & Memory), each tagged NEW or REFRAME against existing code in `../product.md` §4 and `../architecture.md` §5.2.

## Decision Orchestrator responsibilities

- Assemble the Normalised Commercial Object and the parallel specialist context (§5.7 in `../architecture.md`).
- Make exactly one final decision per message: which action (or non-action) is safest.
- Never execute that decision directly — hand it to the Risk + Confidence Gate.
- Never let a specialist role's recommendation bypass the Gate, regardless of that role's own confidence.

## Risk + Confidence Gate responsibilities

- Approve or block the Orchestrator's proposed action.
- Enforce `tenant_scope_verified` — refuses to approve anything where this is `false`, no override (Security Lead's condition, see `SPECIALIST_AGENT_ARCHITECTURE.md`).
- Enforce the always-manual rules: HIGH priority, price negotiation, high-value first-time orders — see `../USE_CASE_TESTS.md` #11-12.
- This is the extended, spec-compliant version of `lib/autoReply.js` — see the engineering reality check in `../product.md` §1: it does not exist in this form in code yet.

## Allowed actions (MVP)

See `../product.md` §12 for the full table with gating conditions. Summary: suppress spam, buffer a burst, ask intent discovery, ask clarification, auto-reply to low-risk routine cases, safe holding reply, generate a quote draft, schedule a follow-up, escalate with a full briefing. Every auto-action must carry a visible one-line reason to the owner (Customer Success's condition) — this is MVP, not later polish.

## Escalation-last rules

Full detail in `../product.md` §9. The MVP does not skip steps to reach escalation faster — buffering, classifying, clarifying, and checking context all happen first, every time, even when the eventual outcome is escalation anyway. This matters because the *audit trail* of what was tried is itself a product asset (see Decision Audit Log below), not just the outcome.

## Confidence handling

Each specialist role and the final Orchestrator decision carries a `confidence` score (see the output contract in `SPECIALIST_AGENT_ARCHITECTURE.md`). Low confidence after a clarification attempt is itself an escalation trigger (`../product.md` §9) — the system does not proceed on a guess it isn't confident in, and does not ask more than two clarifying rounds before deferring to a person (`../USE_CASE_TESTS.md` #5, #7).

## Weak-intent handling

See `../USE_CASE_TESTS.md` #1, #3, #28. One clarifying question, then cooldown; a later message with real content exits cooldown immediately rather than waiting out a timer.

## Spam/burst handling

See `CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md` for the full state machine, and `../USE_CASE_TESTS.md` #2, #4, #28 for worked scenarios. The MVP's hard requirement: a burst of N identical low-information messages costs one classifier pass and produces at most one reply, never N of either — this is a cost-control requirement (Revenue Lead's condition), not just a UX one.

## Discount/promo learning

**Record-only in MVP** — see `../product.md` §10, Revenue Lead's harder gate. No AI-suggested discount, no auto-applied promo, in MVP. Both are separate, future, individually-reviewed GO decisions, not an assumed next step of this MVP.

## Customer score

A signal derived from conversion quality, order history consistency, and response patterns — informs internal prioritisation and future scoring, and explicitly **never gates the quality of service a customer receives** in MVP (`../USE_CASE_TESTS.md` #29). A low score is a learning signal, not a rationing mechanism.

## Tenant-specific intelligence

Pricing rules, promo policy, product categories, customer history, tone, and owner preferences are all scoped per tenant — see `../architecture.md` §5.8 for the isolation guarantee this requires at the RLS level, not just application discipline.

## Learning loop

Full detail in `LEARNING_MEMORY_ARCHITECTURE.md`. Summary: every rep edit, discount, quote/invoice outcome, and escalation validity becomes a structured event — never blind full-chat-history replay into a future prompt.

## MVP cut list

See `../product.md` §13 for the full standing veto, extended by Security Lead. Nothing here is a "not yet, but obviously coming" list — each cut item requires its own future board review, not an assumed unlock.

## Development sequence

The single source of truth is `../architecture.md` §6's reconciled Block 0-16 order. This document does not restate it to avoid drift — read it there.
