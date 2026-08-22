# Invisible Sales OS — Live Demo Script

_First version, written 2026-08-22. This walks the real, live, currently-working core loop: WhatsApp message in → AI triage → drafted reply → approve/auto-send → quote → invoice → stock deduction. Every step below was verified live in-browser as of the 2026-08-21/22 sessions (see `project_product_picker_and_bugs.md` and `project_2026_08_21_session_handoff.md`). Nothing in this script depends on email/IMAP, Tally, or any feature on the cut list — see "What this demo deliberately does not touch," below._

_Companion documents: `PITCH_DECK.md` (the narrative that leads into this), `FIRST_OUTREACH.md` (who you're demoing to)._

**Total time:** 8–10 minutes for the core loop, +3 minutes if you add the optional trust beat at the end. Rehearse it once end-to-end on your own before doing it live in front of anyone — the whole point is that it's real, not a recording, so it has to actually work when you click it.

---

## Before you start — setup checklist

- [ ] Logged in to your own tenant, on a laptop or tablet if possible — bigger screen reads better than a phone for this part (phone is fine for the pitch, not for the click-through).
- [ ] **Catalogue has at least 2–3 real products** with real names, prices, and a non-zero stock quantity (`/app/catalogue`). Use products from the prospect's own trade if you know it in advance — it lands harder when the price and unit ("metre," "kg," "box") is something they'd actually recognise. If you don't know their trade yet, generic wholesale goods are fine.
- [ ] You have a second phone (or the prospect's own phone, if they're willing) that can send a WhatsApp message to your connected business number, live, in front of them. This is the single most convincing moment in the whole demo — a real message arriving in real time beats any amount of pre-loaded data.
- [ ] Check `/app/system` before you sit down — confirm it says **"All systems healthy."** If WhatsApp shows disconnected or Claude shows a breaker open, fix it before the meeting, don't discover it live.
- [ ] Decide your one example product/price in advance so you're not hunting for it on screen.

**One thing to actively avoid:** the marketing login screen (`/login`) currently shows placeholder stat counters — "1,200+ Leads Captured," "89% AI Reply Rate," "£180k Revenue Attributed." These are illustrative placeholder numbers, not real figures — there are no clients yet. Don't linger on that screen and never state those numbers out loud as real. Log in and move straight past it. (Flagged separately to product/eng to get this swapped for honest copy before it's shown to any more prospects — worth checking whether that's landed before you demo again.)

---

## What this demo deliberately does not touch

Don't open, demo, or promise any of these — they're either not live or actively off:

- **Email / IMAP inbox scanning.** Currently disabled (`EMAIL_IMAP_ENABLED=false`) — a real Gmail-side throttling issue being worked through, unrelated to WhatsApp. If asked, be honest: *"Email's coming back online shortly, WhatsApp's the live one today."*
- **Billing / Stripe.** It's wired and tested but in test mode — don't open `/app/billing` and don't imply real charges are flowing. The trial genuinely needs no card, so this shouldn't come up.
- **Tally sync, CRM integrations, broadcast/campaign sending, multi-currency, pipeline kanban.** None of these exist. If asked, see `PITCH_DECK.md`'s objection-handling appendix for how to answer honestly.
- **Settings → Auto-reply configuration screen.** Fine to open if they're curious and technical, but don't lead with it — it's a config screen, not a selling moment.

---

## Part 1 — The message arrives (≈2 min)

**Do:** Have your second phone send a real WhatsApp message to your connected number, live, right now. Use something close to real language for the vertical — for example:

> *"Ji bhai, georgette white kitna hai? 200 metres chahiye, urgent."*

(or the plain-English equivalent for whichever trade you've stocked in the catalogue: *"Hi, do you have any [product] in stock? Need about [quantity], fairly urgent."*)

**Say, while it sends:**
> "I'm going to message this number right now, live — not a recording."

**Do:** Switch to `/app/leads`. Within seconds the new lead appears at the top, with a priority badge (HIGH / MEDIUM / LOW), a score, and — if the message wasn't in English — a language tag.

**Say:**
> "That just landed. No one touched it — it read the message, worked out it's a real order enquiry, not spam or a 'hi,' and scored it. That's what would've been buried in your message list five minutes from now."

---

## Part 2 — The triage, explained (≈1 min)

**Do:** Point at the priority badge and score on the lead you just created.

**Say:**
> "This is doing the thing you do in your head fifty times a day — is this real, is it urgent, is it worth dropping what I'm doing. HIGH means it always waits for you, no matter what — big order, new customer, anything that smells like negotiation. LOW is routine stuff, it can go straight out. MEDIUM sits in between — it gets thirty minutes before it sends, so you've got a window to catch it if you want to."

Don't over-explain the scoring mechanics — one pass is enough, this isn't the point they're buying.

---

## Part 3 — The draft (≈1–2 min)

**Do:** Go to `/app/drafts` — the approval queue. Find the draft tied to the lead you just created.

**Say:**
> "Here's what it wrote back, already — using your actual catalogue and your actual stock, not a guess."

Read the draft out loud. It should reference the real product/price/stock you seeded. If the wording feels a little formal or off, that's fine to say out loud too — it builds trust, not doubt:

> "You can always edit this before it sends — same as fixing a text before you hit send."

---

## Part 4 — Approve and send (≈1 min)

**Do:** Click **Approve** on the draft (or **Edit → Approve** if you want to show the edit flow first).

**Say:**
> "That's it — gone, on your actual WhatsApp, to that actual number. If this had scored as routine instead of the tier I picked, you wouldn't even have needed to click that — it'd already be sent, and you'd just see it happened."

This is the moment to tie straight back to Slide 5 of `PITCH_DECK.md` if you haven't already covered the control mechanic in the pitch itself.

---

## Part 5 — Turn it into a quote (≈2 min)

**Do:** From the lead (or `/app/quotes/new`), start a new quote. Select the lead. Add a line item using the **product search** — start typing the product name and pick it from the real catalogue dropdown, don't type it freehand.

**Say:**
> "Say they come back and say yes, I'll take it. I build the quote from here — and I'm picking the actual product out of your actual catalogue, so the price and what's in stock are always right, not whatever I remember from this morning."

**Do:** Set quantity, let the total calculate, save.

---

## Part 6 — Quote becomes an invoice (≈1 min)

**Do:** From the saved quote, convert to an invoice (or create one fresh at `/app/invoices/new` using the same product-picker flow).

**Say:**
> "One click, and that's now a real invoice — numbered, itemised, ready to send."

---

## Part 7 — The stock moment (≈1–2 min) — this is the proof

**Do:** Before this step, make sure you (or they) noted the stock quantity for that product on `/app/catalogue` back in Part 5. Now, after the invoice is created, go back to `/app/catalogue` and show the same product's stock number.

**Say:**
> "Watch the stock number — it was [X] before that invoice went out. Now it's [X minus the quantity you invoiced]. Nobody had to remember to update anything. The moment the invoice is real, the stock is honest."

This is the single most concrete, verifiable "wow" in the whole demo — it's a number changing in front of them because of something they just watched happen, not a claim. Don't rush past it.

---

## Part 8 — Optional trust beat: the system watching itself (≈2–3 min, only if there's time and interest)

Use this only for a more technical/skeptical prospect, or if the meeting is running long and they're clearly engaged. Skip it for a quick first meeting — Part 7 is a strong enough close on its own.

**Do:** Open `/app/system`.

**Say, in plain terms — don't read the category labels off the screen verbatim:**
> "This page just proves to you nothing's hidden — it's watching WhatsApp, the AI, email, everything, in real time. Right now it says all systems healthy. If anything ever breaks, this is where it shows up first, honestly, not swept under the rug."

---

## Closing the demo

**Say:**
> "That's the whole loop — a message came in two minutes ago, and it's already a real invoice with real stock deducted. That's not a mockup, that's what would be happening in your business every day."

Then move straight into Slide 9 of `PITCH_DECK.md` — the concierge-onboarding ask — while the moment is fresh. Don't let the meeting end on the demo alone; the ask has to land in the same conversation.

---

## If something breaks live

It will, eventually — this is real software, not a rehearsed video. Two rules:

1. **Don't panic-narrate the failure.** A calm "let me try that once more" reads better than visibly scrambling.
2. **Have a fallback lead already sitting in `/app/drafts` from earlier today**, so if the live WhatsApp send in Part 1 doesn't land within ~10 seconds, you can smoothly say *"let's look at one that came in earlier while we wait for that one"* and pick up the walkthrough from Part 2 onward without losing the room. Never leave dead air staring at a loading spinner.
