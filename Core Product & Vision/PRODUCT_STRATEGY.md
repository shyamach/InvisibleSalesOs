# Invisible Sales OS — Full Product Strategy
**Version:** 2.0 — Post Market Research  
**Date:** 2026-06-26  
**Audience:** All board roles — CEO, CTO, AI Specialist, Data Head, CRA, SysArch, Product Engineer

---

## The Real Problem We're Solving

**The Lala Company Problem.**

A UK or South Asian wholesale/distribution SME today runs like this:

1. Customer sends WhatsApp: *"Bhai, 200 boxes protein powder chahiye, urgent"*
2. Sales rep forwards to owner on WhatsApp
3. Owner checks stock mentally or in Tally / paper ledger
4. Owner replies with price from memory or an Excel file
5. Customer says yes
6. Owner tells accountant to raise invoice
7. Accountant opens Tally, manually re-enters everything
8. Invoice sent as a WhatsApp photo
9. Payment chased manually, weeks later
10. No record of what was promised, no pipeline visibility, no performance data

**Every step leaks revenue.** Leads get lost. Follow-ups don't happen. Invoices are raised late. Payments are missed. The owner is the system.

**Invisible Sales OS replaces the owner's head as the operating system.**

---

## Product Vision

> **"From WhatsApp message to paid invoice — fully automated, always human-approved."**

A complete Revenue Intelligence Platform for traditional SMEs (Lala companies) that:
- Ingests leads from ANY source — WhatsApp image, PDF order, Excel sheet, Tally export, voice note, email, website form
- Triages, scores, and drafts personalised responses using AI trained on the company's own voice
- Routes to a human for one-tap approval before anything is sent
- Converts approvals into quotes, quotes into invoices, invoices into payments
- Syncs everything back into Tally and a CRM
- Shows the owner exactly what's happening in their pipeline in real time

---

## Market Position

### Why This Wins Against Meta Business Agent (Launched June 3, 2026)

Meta's free AI agent is a chatbot. It answers questions. It books appointments.

**We close deals and collect money.**

| Meta Business Agent | Invisible Sales OS |
|---|---|
| Generic responses | Brand DNA — your voice, your catalog, your pricing |
| WhatsApp only | WhatsApp + Email + Tally + PDF + Excel + Images + Voice |
| Auto-sends (no human control) | Human-in-the-loop: one-tap approval before every send |
| No invoicing | Full quote → invoice → payment pipeline |
| Data goes to Meta | Data owned by you, in your Supabase |
| Free, generic | Priced for SME, deeply personalised |
| Answers customers | **Closes customers and collects payment** |

### Positioning Statement
> **"Meta's agent answers your customers. Invisible Sales OS closes them."**

The product is NOT a WhatsApp bot. It is a **Revenue Intelligence OS** — the operating system for a Lala company's entire sales pipeline.

---

## Target Customer

### Primary: UK South Asian Wholesale/Distribution SMEs
- Textile distributors, supplement wholesalers, food importers, electronics distributors
- £500K–£10M annual revenue
- 2–20 person teams
- WhatsApp-native operations
- Tally or Excel for accounting
- Pain: leads lost, orders mismanaged, invoicing delayed, no pipeline visibility

### Secondary: India / UAE / Singapore SMEs (same profile)
- Same workflow, same pain, larger market
- India-specific: GST compliance critical
- UAE-specific: multi-currency, Arabic support

### Tertiary: Agency/Reseller channel
- Accountants, CA firms, business consultants who serve Lala companies
- White-label the platform, manage 10–20 clients per agency seat

---

## Full Product Architecture

### Layer 1 — Universal Ingestion Engine (ANY input → structured data)

```
Input Sources:
├── WhatsApp (Meta Cloud API — official)
│   ├── Text messages
│   ├── Images (product photos, handwritten orders) → Claude Vision OCR
│   ├── PDFs (order sheets, catalogs) → Claude Vision
│   ├── Audio/Voice notes → Whisper transcription → AI parse
│   └── Documents (Word, Excel images)
├── Email (IMAP/SMTP — Gmail OAuth2, Outlook OAuth2, generic)
├── File Upload (dashboard)
│   ├── Excel/CSV order sheets → SheetJS parse → AI extract
│   ├── PDF invoices/orders → pdf-parse → AI extract
│   └── Images (catalog pages, handwritten notes) → Claude Vision
├── Tally ERP (XML sync via TallyPrime HTTP bridge)
│   ├── Import: existing customers, products, stock levels
│   └── Export: new invoices, payments back to Tally
├── Tally Form / Website Widget
│   ├── Embeddable enquiry form → webhook → pipeline
│   └── Chat widget → Supabase Realtime
└── Manual Entry (dashboard form)
    └── Sales rep enters offline enquiry → pipeline
```

### Layer 2 — AI Brain (Claude-powered cognitive pipeline)

```
Cognitive Pipeline (4 passes per lead):

Pass 1: BRAND DNA FETCH
└── Load brand voice, product catalog, pricing tiers, RAG context from Supabase

Pass 2: UNIVERSAL PARSER (AI_Parser)
├── Input: raw text / base64 image / PDF binary / audio transcript
├── Model: Claude Sonnet (multimodal) for images/PDFs
│           Claude Haiku for text-only
└── Output: {
     name, company, phone, email,
     products: [{name, quantity, unit}],
     urgency, language, channel,
     raw_text
   }

Pass 3: TRIAGE + ENRICHMENT (AI_Triage)
├── Score: 0-100 (ptc_score)
├── Priority: HIGH / MEDIUM / LOW
├── Product match: fuzzy match against live inventory
├── Customer lookup: existing customer? credit terms? history?
└── Output: {priority, score, matched_products, customer_profile}

Pass 4: INTELLIGENT DRAFT GENERATION (AI_Writer)
├── WhatsApp draft: concise, conversational, brand voice (Haiku)
├── Email draft: full professional copy, brand letterhead (Sonnet)
├── Quote draft: line items, pricing, delivery (template + AI fill)
└── Escalation draft: sales rep briefing note (when escalating)
```

### Layer 3 — Human Approval Layer (the core UI)

```
Approval Queue (the product's heartbeat):
├── View: all outbound_draft rows, newest first
├── Lead card shows: name, company, product, quantity, urgency, score
├── Draft preview: the AI-generated message
├── Actions:
│   ├── ✅ Approve → send immediately via channel
│   ├── ✏️  Edit → inline editor → approve
│   ├── 💰 Quote → convert to formal quote
│   ├── 👤 Escalate → assign to sales rep with briefing
│   └── 🗑️  Dismiss → archive
└── Keyboard shortcuts: A/E/Q/S/D
```

### Layer 4 — Pipeline & CRM

```
Deal States:
LEAD → QUALIFIED → DRAFT_SENT → RESPONDED → QUOTE_SENT → 
NEGOTIATING → INVOICE_RAISED → PAYMENT_PENDING → PAID → FULFILLED

CRM Features:
├── Contact & Company profiles (auto-created from first interaction)
├── Interaction timeline (every WhatsApp, email, call logged)
├── Deal kanban (drag between states)
├── Sales rep assignment & notes
├── Lead nurturing sequences (automated follow-up if no response in N days)
└── Email automation flows (drip campaigns, product updates, reorder reminders)
```

### Layer 5 — Invoicing & Accounts

```
Quote Builder:
├── Line items (matched from product catalog)
├── Quantity, unit price, discount
├── Tax (UK VAT 20% / India GST 18%/12%/5% / UAE VAT 5%)
├── Total + delivery timeline
└── Send as: WhatsApp message, PDF attachment, email

Invoice Engine:
├── Quote → Invoice (one click)
├── Auto-numbered (INV-001, INV-002...)
├── Branded PDF (company logo, address, bank details)
├── Payment link: Stripe (UK/EU) or Razorpay (India) or bank transfer
├── States: DRAFT → SENT → VIEWED → PARTIALLY_PAID → PAID → OVERDUE
└── Automated reminders: 7 days, 3 days, 1 day, overdue

Accounts Sync:
├── Push invoices to Tally (TallyPrime HTTP XML)
├── Push payments received to Tally
└── Pull stock levels from Tally (inventory check before quoting)
```

### Layer 6 — Analytics & Reporting

```
Dashboard (real-time):
├── Revenue this month (total + by channel + by rep)
├── Leads: total / qualified / converted
├── Conversion funnel: Leads → Drafts Approved → Quotes → Invoices Paid
├── Avg. response time (target: < 2 min)
├── Best performing channel
└── Outstanding payments (overdue invoice list)

Reports (exportable PDF/Excel):
├── Sales performance (weekly/monthly/quarterly)
├── Rep performance (leads assigned vs closed)
├── Product demand (most requested products)
├── Customer value (LTV by account)
└── Channel ROI (revenue attributed per channel)
```

### Layer 7 — Sales Rep Mobile Experience

```
When escalation is triggered (complex order / high value / credit issue):
├── Push notification to assigned rep
├── Rep sees: customer name, product, quantity, draft message, customer history
├── Rep actions: send as-is, edit, call, add note
└── All activity logged back to pipeline

Escalation triggers:
├── Order value > threshold (configurable per tenant)
├── Customer has outstanding invoices
├── Product requires negotiation (out of standard tier)
├── AI confidence score < 60%
└── Manual override by approver
```

---

## Data Schema (Revised for Full Platform)

```sql
-- Core lead pipeline
smart_leads         -- contacts, enriched profiles, pipeline state
smart_interactions  -- every message in/out/draft/sent/call/note
smart_deals         -- formal deals with state machine

-- Product & pricing
products            -- catalog (synced from Tally or manually entered)
pricing_tiers       -- tiered pricing per customer segment
inventory           -- live stock (synced from Tally)

-- Orders & invoicing
quotes              -- formal quote documents
quote_items         -- line items on each quote
invoices            -- raised invoices
invoice_items       -- line items on each invoice
payments            -- payments received

-- CRM & automation
contacts            -- person-level (mapped to smart_leads)
companies           -- company-level (one company, many contacts)
sequences           -- automated follow-up schedules
sequence_enrollments -- which leads are in which sequences

-- AI memory
brand_dna           -- voice guidelines, persona, product descriptions
company_knowledge   -- RAG chunks (catalog PDFs, FAQs, pricing docs)

-- Multi-tenancy
tenants             -- each paying customer = one tenant
tenant_members      -- users within a tenant (roles: admin/sales_rep/view)
```

---

## GTM Strategy

### Phase 1 — Niche Domination (Months 1–3)
**Target:** UK supplement/health wholesale distributors (your known vertical)
- 3 pilot customers, free for 3 months
- Weekly check-ins, capture every workflow edge case
- Build case study: "From 50 WhatsApp messages/day to 0 missed leads"
- Referral: every satisfied owner knows 10 other Lala business owners

### Phase 2 — Community Channel (Months 3–6)
**Target:** South Asian business networks, trade associations, BACC (British Asian Chamber of Commerce)
- WhatsApp group presence (where Lala companies actually network)
- CA / accountant partnerships (they're already in Tally, they recommend tools)
- Demo events at trade shows (Pure London, Speciality & Fine Food Fair)

### Phase 3 — Vertical Expansion (Months 6–12)
- Textile distributors
- Food/grocery importers
- Electronics/tech accessories
- Each vertical gets a preset brand DNA template + product catalog schema

### Phase 4 — Agency/White-Label (Months 9–18)
- Accountancy firms managing 10–50 SME clients
- One agency subscription = 20 client workspaces
- Agency sees all clients in one dashboard, clients see only their own

### Pricing (Revised)
| Tier | Price | What They Get |
|---|---|---|
| **Starter** | £35/mo | 1 channel (WhatsApp), 500 leads, 1 user, basic invoicing |
| **Growth** | £99/mo | 3 channels, 2,500 leads, 5 users, quotes + invoices, Tally sync |
| **Scale** | £249/mo | All channels, unlimited leads, 15 users, full CRM, analytics |
| **Agency** | £499/mo | White-label, 20 workspaces, master dashboard |

---

## Revised Sprint Roadmap

### Sprint 1 — Make It Demoable (Weeks 1–3)
1. **Approval UI** — the core workflow loop (priority #1)
2. **Meta Cloud API switch** — official channel, no ban risk
3. **Quote Builder MVP** — text-based quote from approval screen
4. **Multi-tenancy** — `tenant_id` + Supabase RLS

### Sprint 2 — Full Input Pipeline (Weeks 4–7)
1. **Email ingestion** (IMAP, Gmail OAuth2)
2. **File upload pipeline** — PDF, Excel, image → AI parse → pipeline
3. **Image OCR orders** — handwritten order from WhatsApp image → structured lead
4. **Voice note transcription** — Whisper → parse → triage
5. **Real analytics dashboard** — real chart data, conversion funnel

### Sprint 3 — Invoicing + Payments (Weeks 8–11)
1. **Invoice engine** — branded PDF, auto-numbered
2. **Stripe integration** — payment link on invoice (UK/EU)
3. **Razorpay integration** — payment link (India/South Asia)
4. **Automated payment reminders** — 7/3/1 days + overdue

### Sprint 4 — Tally Integration (Weeks 12–15)
1. **TallyPrime XML bridge** — pull stock levels, push invoices
2. **Product catalog sync** — import from Tally
3. **Customer import** — existing Tally customers → CRM contacts
4. **GST/VAT compliance** — correct tax on invoices per region

### Sprint 5 — CRM + Nurturing (Weeks 16–20)
1. **Full CRM** — contacts, companies, deal kanban, timeline
2. **Sequence automation** — follow-up flows (email + WhatsApp)
3. **Lead nurturing** — re-engagement campaigns
4. **Sales rep mobile experience** — escalation notifications
5. **HubSpot sync** (for clients who already use it)

### Sprint 6 — Scale (Weeks 20–28)
1. **Website chat widget** — embeddable script → pipeline
2. **Instagram DMs** — Meta Graph API (same platform as WhatsApp)
3. **Docker + Redis queue** — decouple ingestion from processing
4. **Multi-language support** — Hindi, Urdu, Arabic
5. **Agency white-label** — custom domain per client workspace

---

## The Moat (Why This Is Hard To Copy)

1. **Tally integration** — requires deep knowledge of Tally XML/ODBC protocol. Meta will never build this. Salesforce doesn't bother. This is the wedge into the Lala company workflow.

2. **Brand DNA training** — the AI learns a specific company's voice, pricing logic, product catalog, and customer relationships over time. This gets harder to replace the longer they use it.

3. **Lala-native UX** — designed for how these businesses actually work, not adapted from a Western SaaS template. Simple enough that a non-technical owner can use it from their phone.

4. **Full pipeline ownership** — no other product takes a WhatsApp image → structured order → approved reply → quote → Tally invoice → Stripe payment in one workflow.

5. **Data network effect** — every interaction trains the AI on that business's patterns. The longer they use it, the smarter and more personalised it gets.

---

## What We Build First (This Week)

The single most important build is the **Approval UI**. It is the entire value proposition made visible.

Right now, leads arrive, get triaged, drafts are generated, and they disappear into a Supabase table. No owner can see them. No one can approve or send them. The product is invisible.

Once the Approval UI exists:
- You can demo the product in 3 minutes to any Lala business owner
- You can process a real lead from their WhatsApp to a sent reply
- You have proof the core loop works

Everything else builds on top of that moment.

