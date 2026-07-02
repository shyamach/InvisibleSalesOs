# Invisible Sales OS — Product Spec

_Last updated: 2026-07-02. Decision Brain direction — reviewed by the full board (product-lead, cto-ai, database-lead, security-lead, customer-success, revenue-lead), all six GO WITH CONDITIONS. Conditions are enforced inline below, not just noted. For the change history and full board record, see `PRODUCT_CHANGELOG.md`. Companion to `vision.md` (the why) and `architecture.md` (the how, including the reconciled Block 0-16 build order everything here is sequenced against)._

---

## 1. What we're actually building

Invisible Sales OS is an AI-run **commercial decision engine** for wholesale/distribution SMEs, not a chatbot and not a generic auto-responder. It listens across channels, filters noise, discovers intent, normalises what the customer wants into a structured object, checks real business context (stock, price, customer history, risk), decides the safest next action, acts on it when safe, records why, learns from the outcome, and escalates to a person only when it genuinely should.

- **Not a chatbot.** A chatbot answers messages. This decides what to *do* about them — and "reply" is only one of several possible actions (hold, clarify, quote, escalate, suppress, sleep).
- **Not a generic auto-responder.** Every decision is shaped by this specific tenant's catalogue, pricing, promo policy, customer history, and owner preferences.
- **Decision Brain-led MVP.** The judgment layer is what's being built first and is what the product actually is — not a UI wrapped around a single prompt.
- **Channels are adapters.** WhatsApp, email, and forms feed one decisioning core through thin, replaceable adapters. Adding Instagram or voice later means writing an adapter, not rebuilding the brain.
- **Intelligence is the product.** See `vision.md`'s moat — this is the thing a competitor can't copy by cloning the UI.

**Engineering reality check, stated up front so this doc doesn't repeat a mistake already made once** (see `PRODUCT_CHANGELOG.md`'s 2026-07-02 audit finding): the previously-decided approve-by-exception redesign (§4 below) was documented as decided on 2026-07-01 but never actually implemented in `lib/autoReply.js` — it still runs the older timed-window model. This spec does not get to claim "decided" status for anything below until the code matches it. Section 12 states exactly what's built vs. designed-only, and `architecture.md`'s Block 0-16 order is the only place implementation sequencing lives — this document does not promise a timeline.

## 2. Core customer problem

A Lala business owner gets 50–200 WhatsApp messages a day about orders, prices, and stock. Today, every one of them either interrupts the owner directly or gets forwarded to a rep who checks stock from memory or a spreadsheet and replies whenever they get to it. Leads get lost in the volume. Follow-ups don't happen. Invoices go out late, often as a WhatsApp photo of a handwritten note. Nobody has a record of what was promised. See `vision.md` for the full framing — this section exists only to anchor what follows in the actual pain.

## 3. Core MVP flow

```
Any channel input (WhatsApp / email / form)
  → Conversation Throttle & Signal Buffer   (suppress duplicate/low-info bursts)
  → Signal Classifier                        (spam / weak intent / commercial / support / etc.)
  → Intent Discovery                         (ask, don't assume, when intent is weak)
  → Normalised Commercial Object              (channel-agnostic shape of what's being asked)
  → Controlled Specialist-Agent Decision Brain (context assembly + next-best-action judgment)
  → Risk + Confidence Gate                    (deterministic + optional AI check before anything happens)
  → Safe Action Engine                        (executes — the only layer allowed to)
  → Decision Audit Log                        (why this happened, every time, including non-actions)
  → Memory / Learning Engine                  (structured signals, not blind full-chat replay)
  → Escalate only if the above couldn't safely resolve it
```

Ingestion channels stay exactly as they are today — see §6. This flow sits *inside* the existing pipeline (`engine.js` → triage → catalogue context → draft → `autoReply.js` gate → dispatch/escalation), formalising and extending it, not replacing it. See `architecture.md` §2 for the literal mapping from this flow onto today's files.

## 4. Controlled specialist-agent model

Fifteen roles are documented below because each is a distinct piece of judgment a Lala business owner currently does in their head, and each needs its own accountable definition. **This is not the same as fifteen separate LLM-calling runtime agents** — the board (Product Lead and CTO/AI independently) was explicit that a 15-node orchestration graph is over-scoped for a single-process, pre-revenue product. Each role below is tagged **NEW** (a component that doesn't exist yet) or **REFRAME** (an existing file/function, formalised and possibly extended) so the mapping from "documented role" to "actual code" stays honest. Full detail — inputs, outputs, fallback behaviour, worked examples — lives in `docs/SPECIALIST_AGENT_ARCHITECTURE.md`; this table is the index.

| # | Role | Maps to | Type | Ever an LLM call? |
|---|---|---|---|---|
| 1 | Conversation Throttle & Signal Buffer | **NEW** — extends `lib/rateLimiter.js` | Deterministic/rules | No |
| 2 | Signal Classification | **REFRAME** — extends `AI_Triage.js`'s existing Haiku call | Cheap model (existing call, extended schema) | Yes (already does) |
| 3 | Intent Discovery | **REFRAME** — a clarification-question branch inside the classifier's output | Rules on top of #2's output | No new call |
| 4 | Normalisation / Generic Commercial Object | **NEW** — a schema, not a service (`docs/GENERIC_COMMERCIAL_SCHEMA.md`) | Schema/shape | No |
| 5 | Product Intelligence | **REFRAME** — `lib/catalogueContext.js` | DB lookup | No |
| 6 | Customer Intelligence | **REFRAME** — `contacts` + `smart_leads` history lookup | DB lookup | No |
| 7 | Inventory | **REFRAME** — `products` / `stock_movements` | DB lookup | No |
| 8 | Pricing | **REFRAME** — `products.price` + tenant pricing rules | DB/rules | No |
| 9 | Payment/Account Risk | **NEW** — no current equivalent; MVP is a stub returning "unknown" until real payment history exists | DB/rules (once invoices/payments accumulate) | No |
| 10 | Discount & Promo Intelligence | **NEW** — record-only in MVP, see §10 | DB/rules | No (explicitly, see §10 and §13) |
| 11 | Tenant Policy | **REFRAME** — `tenants.auto_reply` config + new policy fields | DB/rules | No |
| 12 | Industry Playbook | **Phase 2+** — not MVP, see §12/§13 | — | — |
| 13 | Risk & Confidence | **REFRAME** — extends `lib/autoReply.js`'s decision gate | Rules + optional AI | Sometimes |
| 14 | Next-Best-Action | **REFRAME** — the decision output of the extended `autoReply.js` gate | Rules (deterministic given #5-13's inputs) | No |
| 15 | Response/Execution | **REFRAME** — `responder.js` (draft) + `outbox.js`/`escalationService.js` (dispatch) | LLM for drafting, deterministic for dispatch | Yes (already does) |
| 16 | Learning & Memory | **NEW** — extends `ai_learning` table into structured events, see §11 | Structured writer | No |

Roles 5-11 (product/customer/inventory/pricing/payment/discount/tenant-policy) run as **parallel plain async functions inside the existing catalogue-context step**, assembling one structured context object — not as a fleet of independent agents each making their own model call. Only roles 2 (classification) and 15 (drafting) are LLM calls, exactly as many as the pipeline has today. This keeps the token/cost profile unchanged from the current system while adding real judgment — see `architecture.md` §5.7-§5.9 for the parallel-execution and cost-efficiency detail Revenue Lead's review made a hard condition of.

**Security Lead's condition, binding on every role's output contract from day one (see `docs/SPECIALIST_AGENT_ARCHITECTURE.md` for the full schema):** every specialist output and every orchestrator decision carries `tenant_scope_verified: boolean` and `pii_sensitivity: enum`. The Safe Action Engine refuses to execute anything where `tenant_scope_verified` is false — no override. This field cannot be retrofitted later without auditing every historical decision, so it's specified now even though the Action Layer itself doesn't execute against real tenant data until the auth gate clears (§12).

## 5. Signal classification

Every inbound message is classified as one of:

`spam` · `bot` · `repeated_noise` · `weak_intent` · `commercial_intent` · `support_account_query` · `supplier_procurement_query` · `angry_urgent_complaint` · `existing_quote_invoice_payment_query` · `unknown_needs_clarification`

This extends (not replaces) the existing Haiku triage call's output schema — see role #2 in §4.

## 6. Weak intent behaviour

**Example:** Customer sends: *"Hi"*

Decision: weak intent, not noise. Do not escalate — nobody needs to be pulled in for a greeting. Do not ignore — silence reads as the business not caring. Ask one intent-discovery question ("Hi! What can I help you find today?" in the tenant's voice). After that reply, enter a cooldown: don't ask again until the customer sends something with meaningful new information.

## 7. Conversation throttle and burst behaviour

**Example:** Customer sends "Hi" 200 times in 5 minutes (broken client, bot, or a genuinely confused person mashing send).

Decision: detect the repeated low-information burst. Suppress duplicate processing — this does **not** mean 200 classifier calls or 200 replies. Process once. If appropriate, send a single intent-discovery reply (as in §6). Enter a cooldown/sleep state. Wake only when a message arrives with meaningful new information (not another "Hi").

**Customer Success's condition on this behaviour:** suppression must never look like silent message-dropping to the business owner. A tenant-visible counter or daily summary ("47 duplicate messages suppressed today") is required before this ships to a real client — see §12's MVP-allowed list and `docs/CONVERSATION_THROTTLE_AND_SIGNAL_BUFFER.md` for the full state machine.

## 8. Commercial decisioning

Before deciding a next action, the system checks, where relevant to the message:

customer identity · company identity · channel · product match · product category · quantity · delivery/timeline · stock · price · customer score · payment risk · active promo · approved discount rules · quote state · invoice state · conversation state · historical outcomes

This is the parallel context-assembly step (§4, roles 5-11) feeding into the Decision Brain's judgment, not a sequential checklist a human reads.

## 9. Escalation-last principle

Escalation happens only after the system cannot safely: buffer → classify → ask clarification → check context → send a safe holding reply → apply approved policy → create an internal suggestion → fall back safely.

**Escalate for:**
- Low confidence remaining after a clarification attempt
- Hallucination risk (the system isn't sure it knows the real answer)
- Negotiation outside approved pricing rules
- Stock, payment, or customer risk flags
- An angry customer who needs a person to own the relationship
- A high-value first-time order
- Anything genuinely requiring manual judgment

**Customer Success's condition, binding on every auto-executed action, not just escalations:** every action the Decision Brain takes needs a visible one-line reason surfaced to the owner (e.g. *"Auto-replied: known customer, in-stock, standard price"*), and a global pause/override switch discoverable in under 5 seconds. This is MVP scope, not a later polish item — see §12.

## 10. Discount and promo intelligence

**Revenue Lead's review set a harder gate than originally proposed: record-only and suggestion/auto-apply are separate future GO decisions, not one continuous roadmap item.** MVP is strictly:

- Do not invent discounts.
- Record manual discounts a rep applies.
- Record promo usage.
- Record rep approval/rejection of any AI-surfaced observation.
- Record quote outcome and payment outcome tied to any discount.
- No AI-suggested discount, even internally, in MVP.

**Explicitly deferred, each requiring its own separate board review before being built, not an assumed next step:** suggesting a discount internally to a rep; auto-applying an approved promo; any dynamic discounting. None of this is scheduled — see `architecture.md` §6 Block 15.

## 11. Learning loop

Every action creates a structured learning event (not a full-chat replay for future prompting — see `docs/LEARNING_MEMORY_ARCHITECTURE.md` for why blind full-history prompting is explicitly rejected):

rep edits · owner override · manual discount · promo accepted/rejected · quote won/lost · invoice paid/overdue · escalation valid/invalid · spam pattern confirmed · customer urgency style · product alias confirmed · stock issue · customer conversion quality

**Database Lead's condition:** learning events are tenant-isolated at the schema/RLS level, not just by application discipline — Tenant A's raw data must never train Tenant B's decisioning. **Security Lead's condition:** this table will hold real commercial context continuously (not just on failure, unlike the existing `failed_ingestions` design) and needs its own redaction/retention policy before a single real row is written — see §12 and `docs/LEARNING_MEMORY_ARCHITECTURE.md`.

## 12. MVP allowed actions — and what's gated on what

| Action | Gated on |
|---|---|
| Archive/suppress spam | Nothing — safe today |
| Buffer a burst | Throttle component built (`architecture.md` Block 7) |
| Ask intent discovery | Classifier extension built (Block 8) |
| Ask clarification | Classifier extension built (Block 8) |
| Auto-reply to a low-risk routine case | `lib/autoReply.js` actually matching its own decided spec (Block 12) **and** the tenant-scoping auth fix (Block 1) — see the engineering reality check in §1 |
| Safe holding reply | Same as above |
| Generate a quote draft | Same as above, plus Block 0's stock-race fix if the quote touches live stock |
| Suggest a discount internally | **Not MVP** — see §10 |
| Apply an approved promo | **Not MVP** — see §10 |
| Schedule a follow-up | Existing `followUpEngine.js` — already built |
| Escalate with a full briefing | Existing `lib/escalationService.js` — already built |
| **Show the owner a one-line reason for every auto-action** | Customer Success's binding condition — required before any auto-action ships to a real client, not optional polish |
| **Show/use a global pause-override switch** | Same — required before real-client exposure |

## 13. MVP not allowed yet — standing veto, extended by Security Lead

- AI-invented discounts
- Fully autonomous negotiation
- Autonomous credit decisions
- Automatic partial-fulfilment confirmation without an approved tenant policy
- Cross-tenant learning of any kind
- Direct critical-state DB mutations by any specialist role — all writes go through the single existing dispatch/gate chokepoint (`outbox.js`/`autoReply.js`), never a role writing directly
- Uncontrolled autonomous agent loops (no agent triggers another agent without the Orchestrator in between)
- **Extended by Security Lead's Decision Brain review:** no Safe Action Engine execution against real tenant data, and no learning pipeline touching real tenant data, in any environment beyond local dev with synthetic data, until `DEV_BYPASS_AUTH` is removed, tenant scoping is verified-JWT (`req.tenantId`, not the caller-controlled `x-tenant-id` header), webhook HMAC verification exists, and third-party credentials sit in encrypted storage. This is the same pre-launch gate as before (`architecture.md` §7) — the Decision Brain's expanded autonomy just raises its cost, per Security Lead: an unverified caller could now trigger the Action Layer to act *as* another tenant, not just read their data.

---

## 14. Ingestion channels (unchanged)

Three channels are live today, all first-class, all feeding the flow in §3:

| Channel | Path | Status |
|---|---|---|
| **WhatsApp** | Meta Cloud API webhook (production) + whatsapp-web.js live listener (dev / `@lid` fallback) | Live |
| **Email** | IMAP polling in (`lib/emailListener.js`, 60s poll), Resend for outbound (`lib/emailSend.js`) | Live, co-equal channel |
| **Web forms** | Generic `POST /webhook/lead` (Tally, Typeform, custom forms), Zod-validated, rate-limited | Live |

Not yet built (do not start without the gates in §16): Tally ERP sync, image/PDF/voice-note ingestion, Instagram/Messenger DMs, website chat widget — all become channel adapters onto the same Decision Brain when built, per §1.

## 15. Current build status

Live and tested (confirm current count with `npm test` before treating a number here as current — 308 tests / 27 files as of 2026-07-02):
- Three-channel ingestion → one AI pipeline
- Claude Haiku triage → structured JSON → Claude Sonnet draft, with live catalogue/stock context
- Escalation + outcome tracking, sales-rep handoff, catalogue/stock ledger, contact entity model, quote → invoice, multi-tenant Supabase RLS, Stripe billing (test mode), Monday digest

**Not yet built, despite being described as decided in a prior version of this doc:**
- The approve-by-exception decision gate (§4 of the 2026-07-01 spec) — `lib/autoReply.js` still runs the older timed-window model. This is the first thing that must be true before any Decision Brain work touches the Action Layer.
- The entire Decision Brain layer described in §3-§13 above is a **design**, not a build — none of the 30 use cases in `USE_CASE_TESTS.md`'s Decision Brain sections should be read as passing until code exists to test.
- Block 0's data-safety net (`failed_ingestions`, atomic stock RPC, sweeper claim-lock) — confirmed via direct code/migration inspection to be entirely unbuilt.
- Tenant-scoping auth fix — confirmed via direct code inspection: `requireAuth` wired to only 2 of ~7 route groups.

## 16. Cut list (standing — do not re-propose without a named client asking)

WhatsApp broadcast campaigns (ban risk), pipeline kanban view, vanity-metric analytics, multi-currency, invoice accounting (P&L/tax), mobile PWA, CRM integrations (HubSpot/Salesforce), Instagram/Facebook DMs (GDPR review required first), website chat widget, AI-learned channel weighting, Industry Playbook agent (role #12, §4 — Phase 2+, needs real multi-tenant data to be worth building).

Product Lead retains veto over reviving any of these without validated client signal.

## 17. Pricing — open, not decided here

Three different pricing tables exist across legacy docs and disagree with each other — unresolved. **New consideration from Revenue Lead's Decision Brain review:** once the system takes autonomous action (not just drafts), value scales with decision volume and £ throughput, not just seats — a decisions/actions-per-month cap per tier is under consideration as the real gating lever, with per-seat pricing kept as the legible packaging wrapper. Not decided. Revenue Lead owns resolving this in parallel with — but not blocking — the rest of this document; see `PRODUCT_CHANGELOG.md`'s open flags.
