# Market Research — UK South Asian Wholesale/Distribution SMEs & WhatsApp Commerce Tools

_First version, written 2026-08-23. Web research conducted the same day — see sourcing under each figure. This document exists to stop the GTM narrative running on internal opinion alone. It is a primary input to `PITCH_DECK.md` (market sizing, differentiation) and `ICP_AND_OBJECTIONS.md` (competitor objections), not a replacement for either._

_Companion documents: `PITCH_DECK.md`, `DEMO_SCRIPT.md`, `FIRST_OUTREACH.md`, `ICP_AND_OBJECTIONS.md`._

---

## How to use this document

Every number below is sourced and dated. Where a figure is a **derived estimate** (i.e. no single published report gives it directly — it's built by combining two or more sourced figures), that's labelled explicitly and the arithmetic is shown, so anyone can check or challenge it. Don't quote a derived estimate to a prospect as if it were a hard published stat — quote the underlying sourced figures instead, and use the derived number only for internal planning (e.g. "how big could this realistically get").

---

## 1. Market sizing — TAM / SAM / SOM

### 1.1 The building-block figures (all directly sourced)

| Figure | Value | Source | Date |
|---|---|---|---|
| UK wholesale trade enterprises (SIC 46, excl. motor vehicles/motorcycles) | **~102,000** | Statista, *Wholesalers in the UK* | 2023 data |
| UK Wholesale & Retail Trade SMEs (combined sector, all sizes) | **547,000** (10% of all UK SMEs) | GOV.UK, *Business population estimates for the UK and regions 2025* | Start of 2025 |
| Wholesale & Retail Trade share of UK SME turnover | **32%** of all private-sector SME turnover | Same release | 2025 |
| UK SME employers with majority ethnic-minority leadership | **6.1%** (6.6% in England specifically) | GOV.UK Ethnicity facts and figures, *Leadership of small and medium enterprises*, from the Longitudinal Small Business Survey | 2021 data, published 2023 |
| UK SMEs with no employees, majority ethnic-minority-led | **4.9%** | Same source | 2021 |
| Total UK ethnic-minority-led businesses (commonly cited estimate) | **~250,000** | Widely cited across UK Finance, Aston University, Lending Standards Board and others, tracing to earlier ethnic minority business research | Recurring estimate, no single fixed year |
| Ethnic-minority-led business contribution to UK economy | **£74bn/year** (vs. an earlier, more conservative £25bn estimate using older methodology) | OPEN think-tank report commissioned by MSDUK (used AI-assisted name-based ethnicity inference, cross-checked manually) | 2025 |
| Pakistani/Bangladeshi self-employment rate | **23.2%** — the highest of any UK ethnic group | GOV.UK Ethnicity facts and figures, self-employment data | 2019 |
| Indian self-employment rate | **~14%** | Same source family | 2019 |

**Important limitation, stated plainly:** the official GOV.UK leadership-of-SMEs dataset only splits businesses into "White" and "Other — all ethnic groups combined." No published UK government source breaks out Indian, Pakistani, or Bangladeshi business ownership specifically by sector. Anyone who tells you a precise, official "number of South Asian-owned UK wholesale businesses" is citing a figure that doesn't exist in the primary data. What follows in 1.2 is a reasoned estimate built from the pieces above, not a lookup.

### 1.2 TAM — derived estimate, shown with assumptions

**Assumption A:** South Asians (Indian, Pakistani, Bangladeshi communities specifically) are the largest and most business-active sub-group within the UK's "ethnic minority" business population — they have the highest self-employment rates of any ethnic group (23.2% and 14% above, vs. roughly 10-13% for the UK population as a whole) and a long-documented historical concentration in trading, import/export, textiles, and wholesale/retail specifically (see the Huddersfield and Worcester academic reviews of South Asian SMEs in the UK, cited below). A reasonable planning assumption is that South Asians represent roughly **50-65%** of UK ethnic-minority business leadership — this is a judgement call, not a sourced percentage, and should be treated as such.

**Working the numbers:**
- UK wholesale trade enterprises (SIC 46): ~102,000 (Statista, 2023)
- Applying the 6.1% ethnic-minority-SME-leadership rate: ~6,200 ethnic-minority-led wholesale enterprises
- Applying the 50-65% South Asian share assumption: **~3,100–4,000 South Asian-led wholesale enterprises in the UK**

This almost certainly understates the true addressable population, for two reasons the numbers can't capture: (1) SIC 46 alone misses adjacent trading/import-export/distribution activity that gets registered under other codes (general wholesale/retail crossover, manufacturing-with-direct-sale, etc.), and (2) the ICP as defined in `product.md` and the GTM materials is about *how a business operates* (WhatsApp-native, order/quote/invoice volume, family-run) more than strict SIC classification — a business trading textiles or food wholesale informally, or registered as "retail," can still be squarely in-ICP.

**Working TAM: ~3,000–6,000 UK South Asian-owned wholesale/distribution SMEs.** Treat the upper end as more realistic once informal and adjacent-SIC trading activity is accounted for.

### 1.3 SAM — serviceable available market

Narrow the TAM by the ICP filters already in `agents/gtm-lead.md`: turnover £500k–£5m, team of 2–10, WhatsApp-native ordering. Most UK wholesale SMEs are small by employment (the 547,000-strong Wholesale & Retail Trade SME population skews heavily toward micro and small businesses — this is true of UK SMEs generally, where enterprises with 0-9 employees make up the large majority of the total SME population per the same GOV.UK release). A reasonable planning assumption is that **60-75%** of the TAM population above falls inside the 2-10 employee band.

**Working SAM: ~2,000–4,500 businesses.** This is the realistic universe reachable through community/word-of-mouth channels — not a number reachable through paid acquisition at this stage, since the whole GTM thesis (per `agents/gtm-lead.md`) is trust-based distribution, not paid.

### 1.4 SOM — serviceable obtainable market (first 12-24 months)

This is a planning number, not a market-size number — it depends entirely on referral-chain performance, which is unmeasured until client #1 exists. Anchor it to the existing plan in `agents/gtm-lead.md` (5 clients by Day 60) and extrapolate conservatively:

- If each paying client generates even 0.5-1 successful referral within 3-6 months (typical for trust-based community products, not a measured figure for this product specifically), a realistic **Year 1 SOM is roughly 20-50 clients** — well under 2% of the SAM. That's deliberate: the whole channel strategy in `agents/gtm-lead.md` is zero-CAC and relationship-limited by design, not a volume play.
- At the live pricing (see §4), 30 clients on a Starter/Growth blend (~£80-100/mo average) is **~£2,400-3,000 MRR** — a useful sanity-check number for internal planning, not something to put in front of a prospect.

**Bottom line for pitch use:** the honest, defensible version of this story is "several thousand UK businesses fit this ICP, almost none of them are being served by a product built specifically for them" — not a specific headline number. See §5 for why that's also the competitive story, not just the market-sizing one.

---

## 2. WhatsApp usage and behaviour

| Finding | Detail | Source | Date |
|---|---|---|---|
| Global WhatsApp Business reach | 50M+ organisations use WhatsApp Business; ~5M businesses use the WhatsApp Business API specifically | D7 Networks / WapiKit WhatsApp Business statistics roundups | 2025/2026 |
| Standalone WhatsApp Business app | 200M+ monthly active users (2023), 1B+ downloads all-time | Same roundups, citing Meta | 2023 |
| Small business efficiency perception | 67% of small businesses say WhatsApp made customer communication more efficient | Gallabox/WapiKit WhatsApp Business statistics | 2025 |
| Diaspora-comparable market behaviour | **80% of small businesses in India and Brazil use WhatsApp to communicate with customers** | Same roundups | 2025 |
| Enterprise API adoption trajectory | 80% of large enterprises plan to adopt the WhatsApp Business API by 2025; ~15% YoY growth in global API adoption | Same roundups | 2025 |

**Why the India/Brazil figure matters more than a UK-specific number:** no UK-specific survey of WhatsApp-native SME trading behaviour among South Asian businesses was found in this research. The India figure (80% of small businesses using WhatsApp for customer communication) is the closest available comparable, since it's the same diaspora's country of origin and the same informal-trade-via-chat behaviour this product is built around. Treat it as directional evidence for the ICP hypothesis, not UK-specific proof — this is exactly the kind of gap `SURVEY.md`'s Q7-11 (trust and control) is designed to close through direct conversation, per `FIRST_OUTREACH.md`.

---

## 3. Regulatory watch item — not urgent, but worth knowing

In October 2025, Meta/WhatsApp announced a WhatsApp Business Solution Provider policy change, effective **15 January 2026**, barring "general-purpose AI chatbot providers" from using the WhatsApp Business API when the AI assistant itself is the primary product being offered. Reported providers affected included OpenAI, Perplexity, and Microsoft-linked chatbot integrations (TechCrunch, via the search summary — original TechCrunch article not independently re-verified in this pass).

**Read on this product:** Invisible Sales OS is not a general-purpose chatbot — its primary offering is order/quote/invoice management with AI-assisted drafting as one feature inside a broader commercial workflow, materially different from a standalone "chat with an AI" product. This is very likely outside the policy's target, but it's a live regulatory area on the exact channel this product depends on, and worth a standing watch item rather than a one-time check. Flagging here so it's visible to Product/CTO, not resolving it in a GTM document.

---

## 4. Pricing benchmark

Live, currently-billable Invisible Sales OS pricing (confirmed against `controllers/billing.js`, not just marketing copy): **Starter £49/mo, Growth £149/mo, Enterprise £399/mo** (annual: £41/£124/£332). This is what's actually charged through Stripe today — treat it as the number GTM materials use, regardless of the unresolved pricing-table conflict noted in `product.md` §17.

| Tool | Plan / entry price | What it actually is | Source |
|---|---|---|---|
| **Wati** | $59/mo (Growth), $119/mo (Pro) + ~20% markup on Meta's per-message fees | WhatsApp Business API inbox + chatbot flows + broadcast | Chatarmin/YCloud pricing breakdowns, 2026 |
| **Interakt** | ~₹6,897/quarter (≈£65-70/mo) for 5 agents, India-market pricing | WhatsApp CRM + marketing automation, India-centric | Interakt pricing pages, 2025 |
| **respond.io** | $79/mo (Starter) to $279/mo (Advanced), Enterprise on request; WhatsApp/Meta fees billed separately | Omnichannel inbox + automation, not WhatsApp-only | Chatarmin/respond.io pricing pages, 2026 |
| **DialogTab** | $49/mo (Basic) to $199/mo (Scale), per agent | WhatsApp-native, explicitly wholesale/B2B-positioned: catalogues, bulk orders, auto-invoice, payment reminders | DialogTab pricing pages, 2025-2026 |
| **Zotok.ai** | Not publicly listed — demo/sales-led | GenAI order-to-cash on WhatsApp, deep ERP integration (Tally, SAP, Marg, Busy, Odoo), India-focused, built for **brands managing dealer networks**, not a single shop replying to customers | Zotok.ai site, fetched 2026-08-23 |
| **Yellow.ai** | Free tier exists; realistic paid deployment with WhatsApp/voice channels estimated **$3,000-10,000+/mo**; AWS Marketplace lists $10k-$25k/12-month contracts | Enterprise conversational AI platform (35+ channels, 135+ languages), built for large enterprises (Sony, Domino's, Hyundai are cited customers) | CloudTalk/Rasa pricing reviews, 2026 |
| **Meta Business AI / Business Agent** | Free | Meta's own native WhatsApp AI assistant, launched for small businesses (India, May 2026) and expanded (Business Agent, June 2026): answers FAQs on products/pricing/shipping, hands off complex queries to a human. **No quote generation, no invoicing, no stock awareness, no structured commercial actions.** | About Meta announcement, techhelp.ca summary | 2026 |

**What this benchmark shows about Invisible Sales OS's current pricing:** £49-399/mo sits squarely inside the existing market's pricing band, not above it — DialogTab's Basic tier ($49) and Wati's Growth tier ($59) bracket Starter almost exactly; respond.io's Growth ($159) and Wati's Pro ($119) bracket the £149 Growth tier closely. **This research does not suggest the current pricing is off-market — if anything it suggests Invisible Sales OS is priced in line with pure messaging/inbox tools while including quote and invoice generation that none of Wati, Interakt, respond.io, or Zoko include natively.** That's a value argument, not a pricing-change recommendation — per the brief, this document flags pricing signal without overriding Revenue Lead's open decision in `product.md` §17.

---

## 5. Competitive landscape and the actual gap

Four distinct categories of tool showed up in this research, none of which occupy the same position as Invisible Sales OS:

1. **Generic WhatsApp CRM/inbox tools** (Wati, Interakt, Gallabox, Zoko) — built around a shared team inbox, chatbot **flows** (rule-based conversation trees, not open-ended AI drafting), and broadcast/campaign sending. None of the pricing or feature pages surfaced in this research describe an AI that reads an inbound message in natural language and drafts a human-sounding reply in the business owner's own voice, referencing live stock and price. Their core value is routing and automation, not judgement.

2. **India-focused order-to-cash / ERP-integrated platforms** (Zotok.ai, DialogTab) — the closest functional match (both explicitly do quotes, invoices, stock-aware replies on WhatsApp), but built for a fundamentally different shape of business: a **brand or manufacturer broadcasting to a network of dealers/distributors** (one-to-many, B2B channel management, heavy ERP integration like Tally/SAP/Marg), not a single small wholesale shop owner personally replying to individual customer enquiries (one-to-one, conversational). Neither is UK-market-positioned, and neither research surfaced any UK-specific go-to-market or community presence.

3. **Enterprise conversational AI platforms** (Yellow.ai, and by extension Charles/similar) — powerful, multi-channel, multi-language, but priced and sold for large enterprises ($3k-25k+/year realistic spend, sales-led, IT-team-assumed). Structurally inaccessible to a 2-10 person Lala business, both on price and on the assumption of dedicated technical resource to configure and maintain it.

4. **Meta's own native AI** (Business AI / Business Agent, free) — the most important recent development, and the one most likely to come up unprompted in a pitch conversation (see `ICP_AND_OBJECTIONS.md`). It's free, it's native, and it answers routine questions. But by Meta's own description it stops at answering — no quote generation, no invoice generation, no stock-aware structured action, no handoff into a business's actual commercial records. It raises the bar for "does my WhatsApp reply itself" while leaving the entire "does my WhatsApp become a working sales desk" problem untouched.

**The gap, stated plainly:** no tool found in this research combines (a) AI-drafted, natural-language replies in the owner's own voice and catalogue context, (b) automatic quote-to-invoice-to-stock-deduction from that same conversation, (c) pricing and setup accessible to a 2-10 person single-location trading business, and (d) a go-to-market built around how this specific community actually adopts tools — trusted introduction, not self-serve SaaS discovery. That combination, not any single feature in isolation, is the actual competitive position. Slide 7 of `PITCH_DECK.md` is revised to reflect this more precisely than the single-line Meta comparison it previously carried.

---

## 6. What this research does NOT establish — be honest about the limits

- No UK-specific, ICP-specific survey data exists (found in this pass) on WhatsApp order volume, missed-lead frequency, or willingness to pay among South Asian wholesale business owners specifically. The India/Brazil 80% figure (§2) is the best available proxy, not a UK-specific finding.
- The 3,000-6,000 TAM figure (§1.2) is explicitly a derived estimate built on a judgement-call assumption (South Asian share of ethnic-minority business leadership), not a published count. Don't upgrade it to "the market is X businesses" language in a pitch — use the qualitative framing in §1.4 instead.
- No competitor found in this research specifically and publicly targets the UK South Asian wholesale/distribution community as a named ICP. Absence of evidence isn't proof of absence — a smaller, UK-only competitor without much of a web/SEO footprint could exist and simply not have surfaced in this search pass. Treat "nobody else is doing this" as strongly supported, not proven.
- Pricing figures for Interakt, Wati, and others are approximate and drawn from third-party pricing breakdowns rather than always the vendor's own current pricing page — treat as directionally correct, re-verify before quoting a specific competitor price to a prospect who might check it themselves.

---

## Sources

- [Business population estimates for the UK and regions 2025 — GOV.UK](https://www.gov.uk/government/statistics/business-population-estimates-2025/business-population-estimates-for-the-uk-and-regions-2025-statistical-release)
- [Leadership of small and medium enterprises — GOV.UK Ethnicity facts and figures](https://www.ethnicity-facts-figures.service.gov.uk/workforce-and-business/business/leadership-of-small-and-medium-enterprises/latest)
- [Self-employment by ethnicity — GOV.UK Ethnicity facts and figures](https://www.ethnicity-facts-figures.service.gov.uk/work-pay-and-benefits/employment/self-employment/3.0)
- [Wholesalers in the UK — Statista](https://www.statista.com/statistics/292369/wholesalers-number-of-enterprises-in-the-united-kingdom-uk/)
- [Ethnic-minority-led businesses make £74bn annual contribution to UK economy — MSDUK](https://www.msduk.org.uk/news/ethnic-minority-led-businesses-make-74bn-annual-contribution-to-uk-economy/)
- [South Asian ethnic minority small and medium enterprises in the UK: a review and research agenda — University of Huddersfield](https://pure.hud.ac.uk/en/publications/south-asian-ethnic-minority-small-and-medium-enterprises-in-the-u/)
- [Wholesale Companies in Leicester: 1,301 Active Firms (2026) — Firmbase](https://firmbase.co/resources/industry-lists/wholesale-companies-in-the-uk-leicester)
- [Textiles Companies in Leicester: 274 Active Firms (2026) — Firmbase](https://firmbase.co/resources/industry-lists/textile-companies-in-the-uk-leicester)
- [60 WhatsApp Business Statistics You Need to Know in 2026 — D7 Networks](https://d7networks.com/blog/whatsapp-business-statistics/)
- [WhatsApp Business Statistics 2025 — WapiKit](https://www.wapikit.com/blog/global-whatsapp-business-statistics-2025)
- [Latest WhatsApp Business Statistics and Trends — Gallabox](https://gallabox.com/blog/whatsapp-business-statistics)
- [Wati Pricing 2026 — Chatarmin](https://chatarmin.com/en/blog/wati-pricing)
- [Wati Pricing Explained — YCloud](https://www.ycloud.com/blog/wati-pricing)
- [WhatsApp Business API Pricing Structure — Interakt](https://www.interakt.shop/resource-center/whatsapp-business-api-pricing-structure/)
- [Respond.io Pricing 2026 — Chatarmin](https://chatarmin.com/en/blog/respond-io-pricing)
- [Respond.io Pricing](https://respond.io/pricing)
- [DialogTab — WhatsApp for Wholesale & B2B Trade](https://dialogtab.com/sectors/wholesale)
- [DialogTab Pricing](https://dialogtab.com/pricing)
- [Zotok.ai](https://www.zotok.ai/)
- [Yellow.ai Pricing 2026 — CloudTalk](https://www.cloudtalk.io/blog/yellow-ai-pricing/)
- [10 Best Yellow.ai Alternatives — Rasa](https://rasa.com/blog/yellow-ai-alternatives)
- [Introducing Business AI on WhatsApp for Small Businesses in India — About Meta](https://about.fb.com/news/2026/05/introducing-business-ai-on-whatsapp-for-small-businesses-in-india/)
- [Meta's Free WhatsApp AI Agent: Read the Fine Print — techhelp.ca](https://techhelp.ca/metas-ai-business-agent-is-free-your-data-is-the-price/)
