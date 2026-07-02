# Invisible Sales OS — Business Owner Discovery Survey

_Purpose: validate or break the assumptions in `vision.md` and `product.md` before building further on them. Run this as a 20–30 minute conversation, not a form — the follow-up questions matter more than the scripted ones. Target: UK South Asian wholesale/distribution SME owners (textiles, supplements, food import, electronics) — Shyama's personal network for the first pass. See `PRODUCT_CHANGELOG.md` for what's already been decided vs. still open._

**Before you start:** don't lead the witness. Several questions below exist specifically to test assumptions this spec already made (e.g., that WhatsApp volume is 50–200/day, that owners will trust an AI to auto-send). Ask them plainly and let the answer be uncomfortable if it's uncomfortable.

---

## Section 1 — Current workflow (how they actually work today)

1. Walk me through what happened the last time a customer messaged you asking to place an order. Start from the message arriving.
2. Which channel do most of your customer enquiries come through? (WhatsApp / phone call / email / in person / other) — roughly what split?
3. On a typical day, how many customer messages/calls do you or your team handle about orders, prices, or stock?
4. When a message comes in, who decides how to reply — you, a sales rep, whoever's free? Does that person check stock before replying? Where — memory, paper, Excel, Tally, something else?
5. What happens if that message arrives outside working hours, or when you're busy with something else?
6. Tell me about the last time you lost a sale, or a customer got annoyed, because of a slow or missed reply. What actually happened?

## Section 2 — Trust and control (tests the approve-by-exception decision directly)

7. If an AI could reply to a routine "do you have X in stock, what's the price" message automatically, without you seeing it first, how would you feel about that?
8. What would have to be true for you to trust an AI to send a reply to your customer without your approval? What would make you *not* trust it, even after it worked correctly 100 times?
9. If the AI got something wrong in an auto-sent message — wrong price, wrong stock count — what's the actual damage? Recoverable with an apology, or a real problem?
10. Are there specific situations where you'd always want a human involved, no matter how good the AI is? (Probe: price negotiation, big orders, angry customers, new customers, credit terms.)
11. Would you rather review every single message before it's sent, or only be shown the ones that genuinely need your judgment? Why?

## Section 3 — Stock, catalogue, and money

12. How do you currently track stock levels? Does the person replying to a customer always know accurate, current stock — or is it sometimes wrong/outdated?
13. Have you ever confirmed an order you then couldn't fulfil because stock had already gone? How did you handle it with the customer?
14. Walk me through what happens between "customer agrees to buy" and "you've been paid." Where are the manual steps? Where does Tally (or Excel) come in?
15. How long does it typically take from agreeing a deal to sending an invoice? What slows it down?
16. Do customers ever ask to pay by a method you don't currently support easily?

## Section 4 — Team and escalation

17. How many people in your business handle customer enquiries? What's each person's role?
18. When a message needs a sales rep's judgment (negotiation, big order, angry customer), how does it currently get to the right person? How fast?
19. Do you track why a deal was lost (price, stock, slow reply, went to a competitor)? How?

## Section 5 — Willingness to pay and switching cost

20. What do you currently use for this (WhatsApp Business app alone, a CRM, nothing formal)? What do you like/dislike about it?
21. If a tool did everything we just discussed — replied automatically to routine questions, only interrupted you for judgment calls, kept stock accurate, and turned agreed deals into invoices — what would that be worth to your business per month? Don't anchor them with our price; let them name a number first.
22. What would make you cancel a tool like this after using it for a month?
23. Who else in your network runs a similar business and has the same problem? Would you be comfortable introducing us?

## Section 6 — Language and channel reality

24. What language(s) do your customers actually message you in? Does it mix within a single conversation?
25. Would you ever want to handle Instagram or Facebook messages the same way, or is WhatsApp genuinely where this business lives?

---

## After the interview — synthesis checklist

For each conversation, log against `PRODUCT_CHANGELOG.md`'s open flags and `product.md`'s assumptions:
- Does their actual message volume match the 50–200/day assumption in `vision.md`?
- Does their answer to Q7–11 support or contradict the approve-by-exception redesign? This is the single most important validation this survey exists to get — do not skip it or soften it in the summary.
- Any new use case surfaced that isn't in `product.md` §5?
- Any pricing signal from Q21 — feed to Revenue Lead, don't let it sit unrecorded.
- Did they name Tally specifically, or a different accounting tool? This affects the priority of the Tally integration on the roadmap.
