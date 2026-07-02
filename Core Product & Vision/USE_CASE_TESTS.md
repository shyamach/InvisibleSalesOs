# Invisible Sales OS — Use Case Test Sessions

_Purpose: a rigid, scriptable test session per complex use case in `product.md` §5, so "does the product actually handle this" has a concrete, repeatable answer instead of a vibe. Each session is written to be run manually against a real (dev-tenant) environment today, and to seed a real Vitest integration test tomorrow — per Rule #1 ("no code without a test"), any fix for a use case below should ship with a test derived from its scenarios, not just a manual pass. Preconditions assume the dev-fallback tenant (`00000000-0000-0000-0000-000000000001`) and `DEV_BYPASS_AUTH=true`._

_Status column: 🔴 not yet passing (gap) · 🟡 partially covered · 🟢 passing today. Update as sessions are actually run — don't leave this aspirational._

---

## Session 1 — Out-of-stock at time of reply

**Status: 🟢 (existing escalation path)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 1.1 Zero stock, WhatsApp | A `products` row exists with `stock_quantity = 0` | A WhatsApp message asks for that product by name | Lead is created, an escalation is created with reason `out_of_stock`, no auto-reply confirms the sale, rep is notified |
| 1.2 Below reorder point | `stock_quantity` is above 0 but below `reorder_point` | Customer requests a quantity that would take stock negative | System does not silently confirm the full quantity; escalates or offers partial (see Session 5) |
| 1.3 OOS via email | Same as 1.1 but the lead arrives via the email channel | — | Identical escalation behaviour — channel must not change the outcome |

**Pass criteria:** no scenario results in a confirmed sale for stock that doesn't exist. `escalations` row created with correct `reason`. Rep notification fires (push + email per `lib/escalationService.js`).

---

## Session 2 — Price negotiation

**Status: 🟢 (existing escalation path)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 2.1 Explicit haggle | A LOW-triage-eligible product enquiry | Customer follow-up message says "can you do it for less" / "best price?" | Escalates regardless of the LOW/MEDIUM/HIGH triage result — negotiation always routes to a human |
| 2.2 Bulk discount ask | Customer asks for a volume discount not in any pricing tier | — | Escalates; auto-reply must not invent a discount |

**Pass criteria:** negotiation intent always overrides the auto-send decision from §4 of `product.md`, with no exceptions. This should be tested explicitly, not assumed from the triage priority alone.

---

## Session 3 — High-value first-time order

**Status: 🟡 (depends on tenant-configurable value threshold, not yet built — see `PRODUCT_CHANGELOG.md`)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 3.1 New contact, large order | No existing `contacts` row for this phone/email | Message implies an order value above the tenant's HIGH threshold | Treated as HIGH regardless of AI confidence; always manual |
| 3.2 New contact, small order | No existing `contacts` row | Message implies a routine, low-value order | Normal LOW/MEDIUM handling applies — new-contact status alone should not force HIGH |
| 3.3 Existing high-trust contact, large order | Contact has prior completed orders | Large order from the same contact | Should NOT auto-force HIGH purely on value — existing trust changes the risk calculus (open design question, log the answer, don't guess) |

**Pass criteria:** 3.1 always escalates. 3.2 does not over-escalate low-value new contacts (false positives cost the whole value proposition). 3.3 is intentionally left open — record what the survey (`SURVEY.md` Q10) and first real client reveal before hardcoding a rule.

---

## Session 4 — Stock changing mid-conversation

**Status: 🔴 gap — depends on `architecture.md` §5 Block 0 (atomic stock-update)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 4.1 Race between two channels | Product has `stock_quantity = 5` | Two near-simultaneous orders for 5 units arrive on different channels (WhatsApp + email) | Exactly one should succeed; the other must be caught before quote/invoice generation and re-routed (escalate or offer partial), never both confirmed |
| 4.2 Stock sold out between draft and send | Stock is available when the draft is generated | Stock drops to zero (another channel/manual sale) before the auto-send fires | The system re-checks stock immediately before send/quote, not just at initial draft time; does not send a confirmation for unavailable stock |

**Pass criteria:** this session is expected to **fail today** — that's the point. Do not mark it passing until the Block 0 atomic stock-update function (see `architecture.md` §5) is live. Re-run after Block 0 ships and flip status to 🟢 only when 4.1 and 4.2 both hold under concurrent load, not just sequential manual testing.

---

## Session 5 — Partial / split fulfillment

**Status: 🔴 gap — not yet designed, see `product.md` §5 use case 5**

| Scenario | Given | When | Then |
|---|---|---|---|
| 5.1 Order exceeds stock | `stock_quantity = 3` | Customer orders 5 units | System offers partial dispatch (3 now) + backorder (2) as a reviewable draft — does not silently confirm 5, does not silently reduce to 3 without telling the customer, does not blindly escalate a routine partial-stock situation |
| 5.2 Customer rejects partial | Same as 5.1 | Customer declines the partial offer | Lead outcome recorded, no phantom stock reservation left behind |

**Pass criteria:** this is a design gap, not just an implementation gap — do not write the test until the product decision (auto-offer vs. escalate) is confirmed with the product owner and logged in `PRODUCT_CHANGELOG.md`. This entry exists so the gap isn't lost.

---

## Session 6 — Duplicate contact across channels

**Status: 🟡 (data model exists, behaviour untested)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 6.1 Same buyer, two channels | A contact previously messaged via WhatsApp | The same phone number's owner later emails from a known email address linked to that contact | Both interactions attach to the same `contacts` row; conversation history is not split |
| 6.2 Reply-channel resolution | Contact has `preferred_channel` set from a prior explicit request | A new lead comes in via a different channel | Reply goes out on the preferred channel per `lib/channelRouter.js`, not the originating channel |
| 6.3 Unlinked duplicate | Same person messages from an email not yet linked to their WhatsApp contact | — | Two separate `contacts` rows are created (expected today) — confirms this is a known, accepted limitation, not a silent bug |

**Pass criteria:** 6.1 and 6.2 must pass before this is claimed as "handled" anywhere in `product.md`. 6.3 documents the current boundary of the feature so it isn't mistaken for a bug later.

---

## Session 7 — Angry / urgent customer

**Status: 🟡 (escalation trigger exists via `lib/escalation.js`; sentiment-specific coverage unconfirmed)**

| Scenario | Given | When | Then |
|---|---|---|---|
| 7.1 Explicit anger | Message contains clear frustration ("this is the third time I've had to ask," "unacceptable") | — | Flags as a risk exception under the decision gate (`product.md` §4) — holds for human review even if otherwise LOW/MEDIUM |
| 7.2 Urgency without anger | Message says "urgent" / "need this today" with neutral tone | — | Confirm whether urgency alone should trigger review, or only affect priority — this is a real design branch, don't conflate urgency with anger in the implementation |

**Pass criteria:** 7.1 must hold for review. 7.2's expected behaviour should be explicitly decided (not assumed) and logged in `PRODUCT_CHANGELOG.md` once tested.

---

## Cross-cutting regression session — run after any change to `lib/autoReply.js` or `engine.js`

1. A plain LOW-priority routine query (e.g. "what's the price of X") auto-sends with no human touch, on all three channels.
2. A HIGH-priority lead never auto-sends, regardless of any other flag.
3. Every one of Sessions 1–7 above is re-run, not just the one the change targeted — risk-flag logic is shared code; a fix for negotiation detection can silently break OOS detection.
4. `npm test` passes in full before any of the above is considered verified — this document is a complement to the Vitest suite, not a replacement for it.
