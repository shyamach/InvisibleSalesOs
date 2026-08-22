# Invisible Sales OS — Personal Pitch Deck & Script

_First version, written 2026-08-22 for GTM's first activation — auth sprint complete, quote/invoice/stock loop fixed and live-verified the same day. This is the narrative and slide content for Shyama pitching his own personal network 1:1 — not an investor deck, not a volume sales asset. Designed to be delivered from a phone or laptop, sitting across a table or on a call, in under 8 minutes at full length, or under 90 seconds compressed (see "Two speeds," below)._

_Companion documents: `DEMO_SCRIPT.md` (the live walkthrough this deck sets up), `FIRST_OUTREACH.md` (who to show this to and how to get the meeting)._

---

## Two standing rules for this deck (read before editing or presenting)

**1. Language rule.** `vision.md` carries a live board condition from Customer Success: the "Decision Brain" / "autonomous commercial decisioning" framing is internal-only until `SURVEY.md` has actually been run against real Lala business owners — nobody has been asked yet whether that language builds trust or triggers the exact fear it's meant to dispel. Externally, the product is described in the calmer, already-validated terms: *"automated replies for the routine stuff, you're only pulled in when it matters."* Every line in this deck follows that rule. Don't upgrade the language until `SURVEY.md` says it's safe to — see `FIRST_OUTREACH.md` for how the first conversations double as that validation.

**2. Honesty rule.** Nothing below claims a feature that isn't actually live. No Tally sync (not built), no broadcast/campaign sending (deliberately cut — WhatsApp ban risk), no CRM integrations, no multi-currency, no client references yet (there are none — that's handled head-on in Slide 9 and the appendix, not hidden). If product state changes, update this file before the next pitch, not after.

---

## Two speeds

- **Compressed (60–90 seconds, WhatsApp voice note or a "what are you working on" moment):** Slides 1, 3, 5, 9 only.
- **Full (5–8 minutes, sit-down or call):** All nine slides, then straight into `DEMO_SCRIPT.md` if they're hooked.

Either way: this is a conversation, not a read-aloud. Stop after Slide 1 if they're already nodding hard — let them talk.

---

## The opening line (before Slide 1)

Don't open with the product. Open with the relationship and a specific, true observation about their business. Pick whichever fits:

> "Can I show you something I've actually built? It's for exactly the problem you were telling me about with [specific thing they've complained about — messages piling up, an order that got missed, an invoice that went out late]."

If nothing specific comes to mind, fall back to:

> "You run everything through WhatsApp, right? I built something that fixes the one part of that everyone in our community complains about and nobody's fixed. Got two minutes?"

---

## Slide 1 — The moment they already know

**On screen:** nothing yet, or a plain line of text: *"Bhai, 200 boxes chahiye, urgent."*

**Say:**
> "You know this message. Comes in on WhatsApp, maybe from a customer, maybe forwarded by your sales guy. You check stock in your head, or on paper, or you go dig through Tally. You reply with a price you're fairly sure is right. If you're busy, or it's after hours, it sits — and sometimes it just gets buried under the next twenty messages and nobody replies at all."

Let them react. Most owners in this ICP will finish the sentence for you.

---

## Slide 2 — What that actually costs

**Say:**
> "Every one of those steps leaks something. A missed reply is a lost sale. A forgotten quote is a customer who ordered from someone else instead. A late invoice is cash sitting in someone else's account instead of yours. None of it shows up as one big loss — it just quietly costs you every single week, and because it's spread out, nobody ever adds it up."

Keep this short — one line, don't overstay on the pain. They already live it.

---

## Slide 3 — The reveal: this is real, not an idea

**Say:**
> "I didn't just think about this — I built it. It's live right now. Let me actually show you, not describe it to you."

This is the single biggest trust unlock in a personal-network pitch: almost nobody they know has gone from "idea" to "working software." Say it plainly and let it land before moving on. If this is the full 8-minute version, this is the natural point to open the laptop/phone and move into `DEMO_SCRIPT.md`, then come back to Slides 4–9 afterward. If you're mid-conversation with no device handy, keep going.

---

## Slide 4 — How it actually works (three steps)

**Say:**
> "Three things happen, in order. One — you connect your existing WhatsApp number, same as it is today, nothing changes for your customers. Takes about two minutes, no new number, no app to install for them. Two — every message that comes in gets read and scored automatically, so you instantly know which ones are real buyers and which ones are just noise. Three — it writes the reply for you, in your voice, with your actual prices and stock. You look at it, and either it's already gone out or you approve it."

Keep this to the three beats — resist the urge to describe every input channel or future feature. Simple sells here.

---

## Slide 5 — You are always in control

This is the slide that decides whether they trust it. Do not rush it.

**Say:**
> "Here's the part people always ask about first, so let me just tell you straight: nothing goes out that you haven't set a rule for.
>
> If it's routine — someone asking do you have this, what's the price — that can go straight out on its own. You'll still see it happened.
>
> If it's a bit bigger, or less clear-cut, it drafts the reply and holds it for half an hour before sending — so you've got a window to catch it, change it, or just leave it if you're busy and it's fine.
>
> If it's a big order, a brand-new customer, or anything that smells like a negotiation — it always waits for you. No exceptions, doesn't matter what time it is.
>
> So the stuff that needs your judgement still gets your judgement. The stuff that doesn't, stops eating your day."

This is the real, live mechanic (`lib/autoReply.js`) — not a simplification that oversells. Don't say "you approve everything" (that's not true and it undersells the product) and don't say "it decides on its own" (that's not the validated language). This phrasing is both accurate and the calmer external framing at once.

---

## Slide 6 — Beyond the reply: it closes, not just answers

**Say:**
> "Replying is the easy part — plenty of things can reply now. Say the customer agrees to buy: the same system builds the quote using your actual catalogue and real prices, not typed out from memory. Quote becomes an invoice in one click. And the moment that invoice goes out, your stock count updates itself — so the next person who checks knows what's really left, instead of finding out the hard way that it was already sold."

If you're going straight into the demo after this, this is the exact sequence `DEMO_SCRIPT.md` proves live — quote, invoice, stock number visibly dropping.

---

## Slide 7 — Why this, not Meta's free one

**Say:**
> "You might have seen Meta rolled out their own free AI thing for WhatsApp Business earlier this year. It answers questions. That's it — it's a chatbot. This one handles the routine replies for you same as that does, but it also does the part Meta's doesn't touch at all: it turns an agreed order into a quote, a quote into an invoice, and keeps your stock honest. Meta's agent talks to your customers. This one helps you actually get paid."

Don't over-engineer this slide into a feature-comparison table for a 1:1 conversation — one line of contrast is enough. The comparison table lives in `Core Product & Vision/vision.md` if they want more detail later.

---

## Slide 8 — What it costs

**Say:**
> "It starts at £49 a month, no card needed for the first 14 days — you use it properly before you ever pay for it. For comparison, a part-time sales assistant costs you well over £2,000 a month. This isn't trying to replace your people — it's making sure nothing they'd have handled slips through the cracks. Realistically, one order that doesn't get missed pays for six months of this."

The £49/£149/£399 tiers are live on `/pricing` — Starter (£49, 1 WhatsApp number, 500 leads/mo) is the right anchor for a first conversation; don't lead with Growth or Enterprise pricing here, that's a later-stage conversation once they're already in.

---

## Slide 9 — The ask

**Say:**
> "I'm not trying to sign up a hundred people right now — I'm bringing this to a handful of people I actually trust first, and getting it exactly right for them before it goes any wider. If you're up for it, I'll set the whole thing up on your number myself, sit with you through the first week of real messages, and make sure it's actually saving you time before you'd ever think about paying for it. You'd be genuinely one of the first businesses on this. Can I get it running for you this week?"

This is the concierge-onboarding offer — Shyama personally sets it up, not a self-serve signup link. For a founder-led, trust-based first client, this is a strength, not a workaround: it's the reason they say yes to something with no track record yet. The ask is a yes/no on **this week**, not "let me think about it" — if they hedge, the fallback close is:

> "No pressure at all — can I at least show you it live on a real message right now, two minutes, and you tell me after?"

That fallback is the bridge into `DEMO_SCRIPT.md`.

---

## Appendix — If they ask (objection handling)

**"Is anyone else actually using this?"**
Be straight: *"Not yet — you'd be one of the first. That's exactly why I'd set it up myself and stay close to it for the first couple of weeks, rather than just sending you a signup link. You'd get more attention than client fifty ever will."* Don't dodge this — a personal contact will respect the honesty far more than a vague "we have clients."

**"Will WhatsApp ban my number for this?"**
*"No — this isn't a spam tool. There's no bulk broadcasting or campaign-blasting built in at all, on purpose, specifically because that's what gets numbers banned. It reads and replies to real conversations, same as you would."*

**"What if it says something wrong to a customer?"**
Point back to Slide 5's control mechanic: routine-only auto-send, a review window for anything less clear, and big/new/negotiation situations always wait for a human. *"And anything it drafts, you can always edit before it goes, same as texting yourself."*

**"Does it connect to Tally?"**
Be straight, don't oversell: *"Not yet — that's real, it's on the list, not built. Right now it keeps its own accurate record of stock and orders alongside whatever you're already doing in Tally. I'd rather tell you that now than have you find out after you've signed up."*

**"Can it handle Urdu / Punjabi / Hindi, or messages that mix languages?"**
*"Yes — it picks up on the language a message comes in and can reply in kind, including a natural mix, the way people actually text."*

**"What does it cost me if I try it and hate it?"**
*"Nothing. Fourteen days, no card up front, cancel any time. Worst case you've lost twenty minutes setting it up with me."*

**"Is my data safe / going off to some AI company somewhere?"**
*"It's encrypted, it's yours, and it's never used to train some shared model or sold on — that's a hard commitment, not a maybe."*
