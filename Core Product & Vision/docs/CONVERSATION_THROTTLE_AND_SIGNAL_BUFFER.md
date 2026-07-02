# Conversation Throttle & Signal Buffer

_Last updated: 2026-07-02. Full spec for the one genuinely new, deterministic component in the Decision Brain design (`../architecture.md` §6 Block 7). No AI, no migration required to design it — this document is pure logic spec._

---

## Purpose

Before any message reaches the Signal Classifier (and therefore before any model call happens), decide whether it should be processed now, held briefly, or suppressed entirely. This is the component that makes "escalation is the last resort" and "intelligence is the product" actually affordable — without it, a burst of noise costs as much in model calls as a burst of real commercial requests.

## Why this is MVP, not a nice-to-have

Two things break without it: cost (200 duplicate messages should not trigger 200 classifier + draft calls — Revenue Lead's explicit cost-control condition), and correctness (200 replies to "Hi" reads as broken, not helpful — Customer Success's trust condition). Both are MVP-blocking, not polish.

## Burst detection

A burst is a sequence of messages from the same contact/channel within a short window that are near-duplicates or carry no new information relative to the last processed message. Detection compares each new message against the last *processed* (not last *received*) message for meaningful content delta — see "Meaningful delta detection" below.

## Duplicate suppression

Once a burst is detected, subsequent near-duplicate messages within the window do not re-enter the classifier. They are counted, not discarded silently — the count feeds the tenant-visible summary required by Customer Success's condition (see "Audit fields" below).

## Weak-intent cooldown

A weak-intent message (e.g. "Hi") gets exactly one clarifying reply. After that reply, the contact enters `COOLDOWN` — further weak-intent messages in the same vein do not trigger another clarifying question. Cooldown ends when a message with meaningful new content arrives.

## Meaningful delta detection

A message has meaningful delta if it contains information the throttle hasn't already seen for this contact in the current conversation window — a product name, a quantity, a location, a time reference, or any content that isn't a near-duplicate of recent messages. Delta detection errs toward processing when uncertain — a missed real request is worse than one extra classifier call (`../USE_CASE_TESTS.md` #28's fallback rule).

## AI-call suppression

The throttle's entire purpose is to run *before* any model call. A message that doesn't clear the throttle never reaches the Signal Classifier (role 2 in `SPECIALIST_AGENT_ARCHITECTURE.md`) — this is what makes the cost-control guarantee real, not aspirational.

## Token/cost-saving logic

- Cheap, deterministic checks (pattern match against recent message history) always run before any model call.
- A burst that resolves to zero meaningful content costs one weak-intent reply at most, regardless of burst size.
- No summarisation-by-LLM of a burst — the deterministic delta check is enough; an LLM call to "understand" a burst of "Hi"s would defeat the purpose.

## States

| State | Meaning | Entry condition | Exit condition |
|---|---|---|---|
| `ACTIVE_PROCESSING` | Message is proceeding to the classifier now | Default state for a message with meaningful delta | Immediate — hands off to classifier |
| `BUFFERING` | Recent messages are being evaluated for a pattern before deciding | 2nd-3rd near-duplicate message in a short window | Resolves to `SLEEPING` (confirmed noise) or `ACTIVE_PROCESSING` (meaningful delta found) |
| `SLEEPING` | Contact is in a confirmed noise pattern, not being processed | Burst confirmed (`../USE_CASE_TESTS.md` #2) | A message with meaningful delta arrives |
| `COOLDOWN` | One weak-intent reply already sent, awaiting real content | After a weak-intent clarifying reply | Meaningful delta message arrives, or a defined timeout with no further nudge |
| `ARCHIVED_NOISE` | Classified as spam/bot, not held for potential future relevance | Classifier (not throttle) confirms `spam`/`bot` category | Does not auto-exit — a genuinely new, different message from the same contact re-enters at `ACTIVE_PROCESSING` |
| `ESCALATION_HOLD` | Held pending human review, not a throttle state per se but tracked here for completeness | Risk & Confidence Gate decision (role 13), not the throttle itself | Rep action |

## "Hi" flow

See `../USE_CASE_TESTS.md` #1. Single message → `ACTIVE_PROCESSING` → classifier flags `weak_intent` → Intent Discovery asks one question → `COOLDOWN`.

## Repeated "Hi" x200 flow

See `../USE_CASE_TESTS.md` #2. Message 1 as above. Messages 2-3 → `BUFFERING`. Pattern confirmed by message ~4 → `SLEEPING`. Remaining ~196 messages counted, not processed. A message with real content at any point → immediate exit to `ACTIVE_PROCESSING`.

## Useful multi-message burst flow

See `../USE_CASE_TESTS.md` #3. Each message ("Hi" / "need price" / "50 boxes" / "Birmingham tomorrow") carries meaningful delta relative to the last — none are suppressed. The throttle briefly holds (`BUFFERING`) to allow the short sequence to arrive before releasing as one combined commercial request, rather than processing "Hi" alone and then three separate fragmented commercial messages.

## Audit fields

Every throttle decision writes: `contact_id`, `channel`, `burst_id`, `state_transition`, `suppressed_count` (running total for this burst), `timestamp`. This feeds the tenant-visible daily summary ("47 duplicate messages suppressed today") required by Customer Success's condition — suppression must never be invisible to the business owner.

## Learning signals

`burst_suppressed` (with count), `weak_intent_resolved` (did cooldown end with real content or time out unanswered).

## Fallback behaviour

If the throttle component itself fails (an exception in the state logic), the safe default is to process the message individually through the normal pipeline rather than suppress it — a missed suppression costs one extra classifier call; a wrongly-suppressed real message costs a lost lead. This mirrors the "never silently lose a message" principle already established for `../architecture.md` §6 Block 0.
