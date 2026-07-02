# Decision Trees — Use Cases

_Last updated: 2026-07-02. Extensive decision trees for the sixteen scenarios most likely to reveal a bad default if left unspecified. Companion to `../USE_CASE_TESTS.md` (which has the full 14-field breakdown per scenario) — these trees show the branching logic those scenarios imply. Each tree: starting input, decision branches, final actions, escalation rules, learning signals, failure fallback._

---

## 1. Weak intent → order

```
"Hi" received
├─ Throttle: ACTIVE_PROCESSING (first message)
├─ Classifier: weak_intent
├─ Intent Discovery: ask one clarifying question
│   ├─ Customer replies with real content (product/quantity/etc.)
│   │   → exits weak-intent flow, proceeds as a normal commercial request (tree varies by content)
│   └─ Customer doesn't reply
│       → COOLDOWN, no further nudge, thread stays open
Escalation: never, at this stage
Learning: weak_intent_resolved (true/false, and how long it took)
Fallback: if the clarifying question itself fails to send, retry once, then log to dead-letter — never leave the customer's "Hi" completely unacknowledged
```

## 2. Burst spam → sleep/cooldown

```
Rapid near-duplicate messages from one contact
├─ Message 1: ACTIVE_PROCESSING (may be legitimate)
├─ Messages 2-3: BUFFERING (pattern being evaluated)
│   ├─ A message in this window has meaningful delta
│   │   → exit to ACTIVE_PROCESSING, process normally
│   └─ No delta found
│       → SLEEPING
├─ SLEEPING: further duplicates counted, not processed
│   └─ A later message has meaningful delta
│       → exit SLEEPING immediately, process that message normally
Escalation: never purely from volume — only if the eventual real content warrants it
Learning: burst_suppressed (count)
Fallback: throttle failure → process individually rather than risk losing a real message in the noise
```

## 3. Meaningful burst → single processed commercial request

```
"Hi" / "need price" / "50 boxes" / "Birmingham tomorrow" (short sequence, each with new info)
├─ Each message evaluated for delta vs. the last processed one
│   → all four carry delta → none suppressed
├─ Throttle briefly holds (BUFFERING) to let the short sequence complete
├─ Normalisation combines all four into one commercial object: product=protein powder(?), qty=50 boxes, location=Birmingham, timing=tomorrow
├─ Proceeds through the normal commercial-intent pipeline as ONE request
Escalation: per the normal rules for the resulting combined request (e.g. if product is ambiguous → tree 15)
Learning: multi_message_normalised
Fallback: if the hold window expires before the sequence is judged complete, process what's arrived so far rather than waiting indefinitely
```

## 4. Quote → quantity change → re-quote

```
Existing quote for 100 units
├─ Customer: "make it 150"
├─ Inventory re-check for 150 units
│   ├─ Available
│   │   → generate revised quote, reference original quote explicitly
│   │       ├─ Revised terms trigger no new risk flag → auto-send
│   │       └─ Revised terms now cross a threshold (e.g. now high-value) → hold for review
│   └─ Not available at 150
│       → does NOT silently confirm 150; offers partial (tree 16) or holds
Escalation: only on the not-available or newly-flagged path
Learning: quote_outcome (revised)
Fallback: stock re-check failure → hold, do not confirm an unverified number
```

## 5. Quote → negotiation → escalation

```
Existing quote sent
├─ Customer: "can you do better on this?"
├─ Classifier: negotiation signal on an existing-quote context
├─ Always escalates — no auto-resolution path exists, regardless of quote value or customer history
├─ Rep briefing includes: original quote, customer history, any historical discount pattern (surfaced, not auto-applied — tree 7)
Escalation: always
Learning: manual_discount_applied if the rep grants one, linked to quote_outcome
Fallback: none — this path has no automated branch by design
```

## 6. Stock available → stock unavailable before invoice

```
Draft/quote generated when stock was available
├─ Customer accepts / reaches invoice-ready state
├─ Mandatory re-check (not reuse of the original check) immediately before invoice generation
│   ├─ Still available
│   │   → proceed to invoice
│   └─ No longer available (sold via another channel)
│       → do NOT generate the invoice
│       → offer partial (tree 16) if some stock remains, else treat as out-of-stock
│       → explain honestly to the customer, never claim the invoice was sent if it wasn't
Escalation: on the no-longer-available path, if partial isn't policy-approved
Learning: stock_issue
Fallback: **this entire tree depends on the atomic stock-update function existing (`../architecture.md` §6 Block 0)** — until then, this race is a live, unmitigated risk, not just a documented edge case
```

## 7. Manual discount → future discount suggestion

```
Rep applies a manual discount converting a draft/quote
├─ Recorded as manual_discount_applied (learning_events)
├─ Linked forward to the eventual quote_outcome
├─ MVP: this is where it stops — no AI suggestion is generated from this event
├─ (Future, separate GO decision, not automatic): a pattern of repeated manual discounts on similar orders could inform an internally-surfaced suggestion to a rep — explicitly not built, not scheduled, requires its own board review
Escalation: n/a (this is a recording action, not a decisioning one)
Learning: manual_discount_applied is itself the learning signal
Fallback: write failure → discount still applies to the commercial transaction; only the learning record is at risk, never the customer-facing action
```

## 8. Approved promo → auto-eligible offer

```
Order matches a tenant-configured, pre-approved promo's criteria
├─ Discount/Promo role detects eligibility
├─ MVP: recorded as promo_eligible_not_applied, surfaced to the rep as an internal note only
├─ AI does NOT mention the promo to the customer in MVP
├─ (Future, separate GO decision): auto-applying within tenant-approved policy — explicitly not MVP, requires its own board review per Revenue Lead's condition
Escalation: no, unless another flag fires independently
Learning: promo_eligible_not_applied
Fallback: none needed — MVP behaviour is uniformly conservative here
```

## 9. Known customer vs. new customer

```
Message arrives
├─ Customer Intelligence resolves identity
│   ├─ Known contact, clean history
│   │   → normal handling, customer history available as context (reorders, tone matching, etc.)
│   ├─ Known contact, history includes a payment issue or unresolved escalation
│   │   → treated more conservatively even for otherwise-routine requests
│   └─ New contact (is_new_contact = true)
│       → Payment/Account Risk returns "unknown" (MVP stub)
│       → high-value new-contact orders always escalate (tree from ../USE_CASE_TESTS.md #11)
│       → routine, low-value new-contact requests can still auto-handle (being new alone doesn't force escalation — over-escalating false-positives costs the product's value prop)
Escalation: value- and risk-driven, not purely "new vs. known"
Learning: customer_conversion_quality
Fallback: ambiguous identity match → treat as new rather than guessing which existing contact
```

## 10. Customer accepts quote → pre-invoice stock check

```
Customer: "yes, go ahead" on an outstanding quote
├─ Do NOT proceed straight to invoice from the quote-time stock snapshot
├─ Mandatory fresh stock re-check at acceptance time
│   ├─ Clean
│   │   → proceed to invoice generation (tree 11 covers what happens if that step itself fails)
│   └─ Stock has moved since the quote
│       → hold, explain honestly, do not generate an invoice for stock that no longer exists
Escalation: only on the hold path
Learning: quote_accepted, quote_outcome: won (once invoice actually issues)
Fallback: re-check failure (technical, not a stock problem) → hold rather than guess either way
```

## 11. Invoice generation failure → safe fallback

```
Invoice generation triggered (post-acceptance, stock re-check passed)
├─ PDF generation or a downstream write fails
├─ Retry once
│   ├─ Succeeds on retry
│   │   → proceed normally, no customer-visible impact
│   └─ Fails again
│       → hold for manual invoice generation
│       → notify the owner (operational alert, not a commercial escalation)
│       → if any customer-visible delay results, send a holding message — never claim "invoice sent" falsely
Escalation: operational, not commercial-judgment
Learning: none (infrastructure issue, not a decisioning learning signal)
Fallback: this tree IS the fallback path referenced by trees 6 and 10
```

## 12. Duplicate customer across channels

```
Message arrives
├─ Customer Intelligence attempts identity resolution
│   ├─ Confidently linked to an existing contact via another channel (e.g. contacts.channels)
│   │   → attaches to the same contact, single conversation history preserved
│   │   → reply routes via contact's preferred channel (channelRouter.js), not necessarily the originating one
│   └─ Not confidently linked
│       → creates a new, separate contact record (accepted current limitation)
│       → does NOT silently guess and merge on a weak match
Escalation: no, unless the ambiguity itself compounds with another risk flag
Learning: none directly
Fallback: n/a — the "create separate record" path is itself the documented, accepted fallback, not a bug to hide
```

## 13. Angry customer

```
Message expresses clear frustration
├─ Classifier: angry_urgent_complaint (distinct category from urgency-without-anger, tree not conflated with commercial urgency)
├─ Risk flag: sentiment_negative
├─ Always holds for a person, regardless of the underlying request's commercial triviality
├─ Fast-tracked priority in the rep queue
├─ Brief acknowledgement only sent automatically — no attempt to resolve the substance automatically
Escalation: always
Learning: escalation_valid (once outcome known)
Fallback: uncertain sentiment detection → still err toward holding, a false-positive escalation is cheaper than missing a genuinely angry customer
```

## 14. Payment-risk customer

```
Existing customer with an overdue invoice, or unknown payment history (new contact), places a new order
├─ Payment/Account Risk role checks status
│   ├─ Known clean history
│   │   → normal handling
│   ├─ Known overdue invoice
│   │   → holds for review, briefing includes the overdue details
│   └─ Unknown (new contact, MVP stub default)
│       → treated conservatively — held for review by default in MVP, since the role can't yet assert "safe"
Escalation: yes, on the overdue and unknown-conservative paths
Learning: escalation_valid/invalid feeds whether the conservative unknown-default is too cautious once real payment data accumulates
Fallback: n/a — conservative-by-default is itself the fallback, not a special case
```

## 15. Product ambiguity

```
Request references a product with multiple plausible matches
├─ Product Intelligence returns candidates below a confident single-match threshold
├─ Ask which one, presenting the top candidates
│   ├─ Customer clarifies
│   │   → proceeds normally with the resolved product; product_alias_confirmed recorded
│   └─ Customer's follow-up is still ambiguous
│       → escalate rather than guess a second time
Escalation: after 2 rounds of unresolved ambiguity, not before
Learning: product_alias_confirmed
Fallback: n/a — the ask-then-escalate sequence is itself the fallback
```

## 16. Partial fulfilment

```
Order quantity exceeds available stock
├─ **Design decision not yet finalised** (product.md §5 use case 5) — this tree reflects the proposed, not-yet-approved default
├─ Proposed: auto-offer partial dispatch (available quantity now) + backorder (remainder) as a reviewable draft
│   ├─ Customer accepts the partial offer
│   │   → proceeds as a modified order, stock re-checked again at commitment (tree 6)
│   └─ Customer declines / wants to negotiate the shortfall
│       → falls into tree 5 (negotiation → escalation)
├─ Never: silently confirm the full original quantity
├─ Never: silently reduce to the available quantity without telling the customer
Escalation: only on the decline/negotiate path, or always, until the design decision is formally logged in PRODUCT_CHANGELOG.md
Learning: none defined yet — pending the design decision
Fallback: until decided, default to escalation rather than guessing at the right proposed split
```
