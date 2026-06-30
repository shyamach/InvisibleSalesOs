# Invisible Sales OS — Product Roadmap
**Target:** Industry-best SME Sales Intelligence SaaS  
**Model:** Multi-tenant B2B SaaS, subscription pricing  
**Last updated:** 2026-06-26

---

## Vision

> The CRM that works while you sleep. Every inbound message — WhatsApp, email, form, DM — is triaged, scored, drafted, and approved in under 2 minutes. No missed leads. No manual data entry. Full pipeline visibility on one screen.

---

## Current State (Sprint 0 — DONE)

- ✅ WhatsApp Web listener (local, dev)
- ✅ AI triage gatekeeper (Claude Haiku, score-based routing)
- ✅ Multimodal lead parser (text + image + PDF)
- ✅ Outreach writer (Claude Sonnet, brand context)
- ✅ Supabase sync (smart_leads + smart_interactions)
- ✅ Google Sheets backup (non-blocking)
- ✅ Express dispatch API with auth
- ✅ Next.js frontend (login, dashboard, pipeline, integrations)
- ✅ Supabase OTP + OAuth auth
- ✅ 13 automated tests (Vitest)

---

## Sprint 1 — Production-Ready Core (Weeks 1–3)

**Goal:** Replace local hacks with production infrastructure. First paying customer possible.

### 1.1 Switch to Meta Cloud API (CTO + SysArch)
- [ ] Deprecate `whatsapp-web.js` / Puppeteer approach entirely
- [ ] Register Meta App, configure webhook in Business Manager
- [ ] Wire `controllers/whatsapp.js` into the Express server as the primary receiver
- [ ] Add webhook signature verification (HMAC-SHA256 on X-Hub-Signature-256)
- [ ] Support all message types: text, image, document, audio, interactive buttons
- **Why:** Official API doesn't get banned, scales to 1M messages/day, supports template messages

### 1.2 Multi-Tenant Architecture (Data Head + CTO)
- [ ] Add `tenant_id` column to `smart_leads`, `smart_interactions`, `brand_dna`
- [ ] Enable Supabase Row-Level Security (RLS) so tenant A cannot read tenant B's data
- [ ] Create Supabase Auth + organizations (one org per customer)
- [ ] Seed `brand_dna` per tenant on signup
- **Schema addition:**
  ```sql
  ALTER TABLE smart_leads ADD COLUMN tenant_id UUID REFERENCES auth.users(id);
  ALTER TABLE smart_interactions ADD COLUMN tenant_id UUID REFERENCES auth.users(id);
  CREATE POLICY "tenant isolation" ON smart_leads
    USING (tenant_id = auth.uid());
  ```

### 1.3 Real Embeddings + RAG (AI Specialist)
- [ ] Integrate `voyage-3` embeddings via Anthropic API or `text-embedding-3-small` via OpenAI
- [ ] Wire `match_company_knowledge()` in `engine.js` with real vectors
- [ ] Allow tenants to upload product catalogues, FAQs, pricing sheets → chunk + embed
- [ ] RAG retrieval improves reply personalization dramatically

### 1.4 File Upload Pipeline (CRA + Product Engineer)
- [ ] Wire `frontend/src/app/app/pipeline/page.tsx` file upload to a real API route
- [ ] Create `POST /api/pipeline/upload` → Supabase Storage → parse → embed → store
- [ ] Support: PDF catalogues, CSV lead lists, product images
- [ ] Show processing status in the UI (pending → processing → processed)

### 1.5 Approval UI — Human-in-the-Loop (Product Engineer)
- [ ] Build a "Drafts" view showing all `outbound_draft` interactions
- [ ] One-click "Send" button calls `/api/responder/dispatch` with `x-internal-key`
- [ ] One-click "Edit then Send" inline editor
- [ ] Keyboard shortcut: `A` to approve, `E` to edit, `D` to dismiss
- **This is the core workflow loop — everything leads here**

### 1.6 Test Coverage Expansion (All Roles)
- [ ] `parser.js` — unit tests for messy text, image OCR simulation
- [ ] `engine.js` — integration test with Supabase mock
- [ ] `outbox.js` — meta API mock test
- [ ] Coverage target: 80%+ before Sprint 2

---

## Sprint 2 — Email Channel + Analytics (Weeks 4–6)

**Goal:** Second revenue channel live. Dashboard shows real business value.

### 2.1 Email Ingestion (CTO + Product Engineer)
- [ ] IMAP listener using `imapflow` — polls inbox every 30 seconds
- [ ] Parse sender, subject, body → compile payload → `processLeadThroughCognitiveEngine`
- [ ] Support Gmail (OAuth2), Outlook (OAuth2), and generic IMAP
- [ ] Connect frontend email configuration form to real API: `POST /api/integrations/email`
- [ ] Forward leads via SMTP (use `nodemailer` with Resend relay)

### 2.2 Analytics Dashboard (Data Head + Product Engineer)
- [ ] Replace stub analytics page with real charts:
  - Leads per day (last 30 days) — line chart
  - Channel breakdown (WhatsApp vs Email vs Manual) — donut
  - Priority distribution (HIGH / MEDIUM / LOW) — bar
  - Approval rate (sent / total drafts) — metric card
  - Avg. response time (created_at → direction = outbound_sent) — metric card
- [ ] Use Recharts (already in frontend deps) + Supabase real-time subscriptions
- [ ] Add `created_at` index on `smart_interactions` for fast date-range queries

### 2.3 Lead Detail Page (Product Engineer)
- [ ] `/app/leads/[id]` — full conversation timeline for each lead
- [ ] Show: all interactions (inbound + drafts + sent), lead metadata, edit fields inline
- [ ] Quick actions: re-draft, mark as closed/won/lost, assign to team member

### 2.4 Tally + Manual Entry (CRA)
- [ ] Tally webhook: `POST /api/ingest` with `x-source-channel: tally`
- [ ] Manual entry form in pipeline page: paste offline notes → engine processes them
- [ ] Bulk CSV import: upload file → parse each row → run through triage → batch insert

---

## Sprint 3 — Invoicing + Payments (Weeks 7–10)

**Goal:** Close the sales loop inside the product. Revenue attribution becomes real.

### 3.1 Quote Builder (CRA + Product Engineer)
- [ ] After approving a WhatsApp/email draft, one click creates a quote
- [ ] Quote fields: line items, quantity, unit price, tax, discount, total
- [ ] Send quote as: PDF attachment, WhatsApp formatted message, or email
- [ ] Quote templates per product category

### 3.2 Invoicing Dashboard (CRA + Product Engineer)
- [ ] Convert accepted quote → invoice (auto-numbered, branded PDF)
- [ ] Invoice states: draft → sent → viewed → paid → overdue
- [ ] Supabase tables: `quotes`, `invoices`, `invoice_items`
- [ ] Stripe integration for online payment link on invoice
- [ ] Razorpay alternative for India market (important for SME target)

### 3.3 Revenue Attribution (Data Head)
- [ ] Tag every invoice with `lead_id` and `channel`
- [ ] Dashboard metric: "Revenue attributed to WhatsApp leads this month"
- [ ] Conversion funnel: Leads → Drafts Approved → Quotes Sent → Invoices Paid

### 3.4 Automated Follow-Up Sequences (AI Specialist)
- [ ] If quote is sent but not responded to in 48h → auto-draft follow-up via Claude
- [ ] Configurable follow-up cadence per tenant (1 day, 3 days, 7 days)
- [ ] Uses `pg_cron` or a simple cron job querying Supabase for stale quotes

---

## Sprint 4 — Multi-Channel Expansion (Weeks 11–14)

**Goal:** Every inbound channel an SME uses is covered.

### 4.1 Instagram DMs
- [ ] Meta Graph API: Instagram Messaging (same developer platform as WhatsApp)
- [ ] Share `AI_Triage.js` and `Responder.js` — channel-agnostic
- [ ] Add `channel: 'instagram'` to lead records

### 4.2 LinkedIn (via Phantombuster or official API)
- [ ] Monitor connection requests and DMs from target ICPs
- [ ] Enrichment: pull company size, role, industry from LinkedIn profile
- [ ] Higher-quality lead context for writer.js

### 4.3 Website Chat Widget
- [ ] Embeddable `<script>` tag — drop on any SME website
- [ ] Real-time chat powered by Supabase Realtime subscriptions
- [ ] Visitor captured as lead → same engine pipeline

### 4.4 Voice / WhatsApp Voice Notes (AI Specialist)
- [ ] Transcribe audio messages using Whisper API (OpenAI) or AssemblyAI
- [ ] Feed transcript to triage + writer pipeline
- [ ] Show transcript in lead detail view

---

## Sprint 5 — Enterprise + Scale (Weeks 15–20)

**Goal:** Land mid-market clients. Handle 10k+ messages/day per tenant.

### 5.1 Team & Role Management
- [ ] Invite team members to workspace (roles: Admin, Sales Rep, View Only)
- [ ] Assign leads to specific reps
- [ ] Rep sees only their assigned leads
- [ ] Notification system: "New HIGH priority lead assigned to you"

### 5.2 CRM Integrations
- [ ] **HubSpot**: 2-way sync of leads and deal stages
- [ ] **Salesforce**: push qualified leads as Opportunities
- [ ] **Pipedrive**: sync deals and activities
- [ ] Use Zapier/Make webhooks as fallback for any CRM

### 5.3 White-Label / Agency Mode
- [ ] Agency buys one subscription, manages 10 client accounts
- [ ] Each client has their own `brand_dna`, channels, and analytics
- [ ] Custom domain per client (e.g., `sales.clientbrand.com`)

### 5.4 Infrastructure (CTO + SysArch)
- [ ] Containerize backend with Docker
- [ ] Deploy to Railway / Render (simple) or AWS ECS (enterprise)
- [ ] Message queue (BullMQ / Redis) — decouple ingestion from processing
- [ ] Rate limiting middleware (100 req/min per tenant)
- [ ] Correlation IDs on all log lines for distributed tracing
- [ ] Health check endpoint `/health` returning uptime + DB status
- [ ] Minimum 2 GB RAM container for Chromium (if keeping whatsapp-web.js fallback)

---

## Pricing Model (Post-Sprint 3)

| Tier | Price | Limits | Target |
|---|---|---|---|
| **Starter** | $49/mo | 500 leads, 1 channel, 1 user | Solo founder / freelancer |
| **Growth** | $149/mo | 2,500 leads, 3 channels, 5 users | Small sales team (2–10 people) |
| **Scale** | $399/mo | Unlimited leads, all channels, 25 users | Growing SME |
| **Agency** | $799/mo | Unlimited, white-label, 20 client workspaces | Marketing agencies |

**Key metrics to track:**
- MRR (Monthly Recurring Revenue)
- Churn rate (target: < 3% monthly)
- Leads processed per account (usage-based upsell signal)
- Time-to-first-draft (product quality metric, target: < 90 seconds)

---

## Tech Debt Log (Handle Before Sprint 3)

| Item | Risk | Owner |
|---|---|---|
| `pg` package still in dependencies (unused after engine.js rewrite) | Low — just bloat | CTO |
| `@google/generative-ai` in package.json — never imported anywhere | Low — remove | CTO |
| `optimizer.js` — stub only, never called | Medium — needed for self-improvement loop | AI Specialist |
| No database migration files — schema lives only in Supabase UI | High — can't reproduce DB | Data Head |
| `train.js` in root — unknown purpose, untested | Medium | AI Specialist |
| `public/app.js` in root — unknown purpose | Medium | Product Engineer |
| Test coverage below 20% | High — Rule #1 violation | All roles |

---

## Board Role Sprint Ownership

| Sprint | CEO Focus | CTO | AI Specialist | Data Head | CRA | SysArch |
|---|---|---|---|---|---|---|
| **S1** | Onboard first 3 pilot customers | Meta API switch | Real embeddings | RLS policies + schema | Approval UI | Docker setup |
| **S2** | Pricing page launch | Email IMAP | Follow-up drafts | Analytics views | Lead detail page | Redis queue |
| **S3** | First paid invoice demo | Stripe/Razorpay | Sequence AI | Revenue attribution | Quote builder | Health checks |
| **S4** | Instagram partnership | Multi-channel infra | Voice transcription | Cross-channel attribution | Widget embed | CDN + caching |
| **S5** | Enterprise sales motion | AWS ECS migration | Self-learning loop | CRM sync | White-label | 99.9% uptime SLA |
