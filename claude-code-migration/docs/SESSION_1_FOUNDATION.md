# SESSION_1_FOUNDATION.md

> Migration document for Claude Code / new AI sessions.
> Captures the complete foundation of Invisible Sales OS — decisions, architecture, rules, workflows, risks, and open threads.
> Do not delete. Update this file when major decisions change.

---

## 1. Original Project Goal

**Invisible Sales OS** is a revenue intelligence SaaS for South Asian wholesale/distribution SMEs, known internally as "Lala companies." The product converts the sales inbox into an automated pipeline.

**The core problem:** Lala business owners receive 50–200 WhatsApp messages per day about orders, prices, and inquiries. They lose revenue through missed follow-ups, slow responses, and no visibility into pipeline. No tool in this market speaks to them — they are WhatsApp-native, trust-driven, price-sensitive, and largely ignored by generic CRMs.

**The solution:** An AI-powered inbox that triages inbound messages from any channel (WhatsApp, Email, forms), generates contextual draft replies (aware of catalogue, stock, language), routes them for human approval or auto-sends, and tracks every conversation from first message to closed deal.

**CEO:** Shyama — UK-based, deep personal network in the Lala market, final decision authority on product. Her personal network is the primary GTM channel (zero CAC). She is direct, concise, and prefers opinionated board pushback over rubber-stamping.

**Target market:** UK-based South Asian wholesale/distribution SMEs. GBP-only at launch.

**GTM sequence:** Auth → Full product design (industry-standard SaaS quality) → GTM → First client. Design is a pre-GTM gate, not a post-revenue luxury.

---

## 2. Key Decisions Made

### Product

| Decision | Rationale |
|----------|-----------|
| WhatsApp as primary channel | Lala businesses are WhatsApp-native. This is where deals happen. |
| Email as equal channel (Phase 1) | IMAP ingestion + Resend dispatch. Same AI pipeline as WhatsApp. |
| Tally/forms as third source | Generic webhook normalises any form payload to lead schema. |
| Auto-reply with approval window | Not binary. LOW = auto, MEDIUM = 30-min window, HIGH = always manual. |
| Contact entity model | One person → multiple channels. `preferred_channel` is contact-level, not lead-level. |
| Catalogue with live stock | `inventory` table (extended as product catalogue) + append-only `stock_movements`. |
| Sales rep handoff + outcome tracking | OOS / price negotiation → escalate to rep → track converted/rejected/stalled. |
| Quote → Invoice pipeline | Not accounting. A sales tool. Shyama specifically kept this. |
| Monday 8am digest email | Retention mechanism. Claude Haiku narrative. Shyama specifically kept this. |
| Direction C design system | Warm & Trustworthy: walnut `#1c1612` sidebar, cream `#faf8f5` canvas, amber `#c87941` accent. Full redesign across all pages. |
| Channel-based pricing tiers | Starter £49 (1 channel), Growth £149 (3 channels), Enterprise £399 (unlimited + CRM). |

### Cut / Deferred (do not re-propose without client signal)

| Cut | Reason |
|-----|--------|
| WhatsApp broadcast campaigns | Existential ban risk. Only with Meta-approved templates. Phase 3+. |
| Pipeline kanban view | No client asked for it. |
| Analytics page | Vanity metrics before real data. |
| Multi-currency | GBP only. Re-evaluate at 10 paying clients. |
| Invoice accounting (P&L, tax) | Scope creep. Invoices are a sales tool, not bookkeeping. |
| Mobile PWA | Tailwind responsive is sufficient. |
| CRM integrations (HubSpot, Salesforce) | Deferred until enterprise client demand confirmed. 2-3 months per integration. |
| Instagram / Facebook DMs | Phase 2. Meta Business verification required. GDPR consent review needed first. |
| Website chat widget | New product surface. Significant UX work. Validate first. |
| AI-learned channel weighting | Data needed to train. Phase 3. |

### Architecture

| Decision | Rationale |
|----------|-----------|
| ES modules throughout | `import/export` only. `"type": "module"` in package.json. Mixing CJS/ESM crashes the server. |
| No raw pg | All DB via Supabase client. Raw pg was removed in early audit because it bypasses RLS. |
| Supabase shared-table multi-tenancy (Option A) | Every table has `tenant_id UUID NOT NULL`. RLS enforces isolation. |
| `@supabase/ssr` for auth | `createBrowserClient` in browser (writes cookies), `createServerClient` in Next.js middleware. Cookie-based sessions — localStorage alone breaks the middleware. |
| `DEV_BYPASS_AUTH=true` | Bypasses JWT validation in local dev. Never ship to production with this set. |
| Stripe inline `price_data` | No pre-created Stripe Price IDs needed for test mode. STRIPE_PRICE_* env vars take priority if set. |
| Express webhook body parsing order | Stripe webhook must use `express.raw()` BEFORE `app.use(express.json())`. Order matters. |
| Singleton AI clients | Anthropic + Supabase clients instantiated once at module level. Never inside request handlers. |
| Vitest for tests | Not Jest. Not Node's built-in runner. Rule #1: no code without a test. |

---

## 3. Important Workflows Designed

### Core AI pipeline
```
Inbound message (WhatsApp / Email / Form)
  → Source normalisation → RawLead shape
  → Contact resolution (match phone/email → contacts table)
  → Invoice detection (runs FIRST — early return if invoice)
  → AI_Triage.js (Claude Haiku, ~400 tokens)
      → structured JSON: priority, intent, customer_name, product_interest,
        estimated_value, follow_up_date, reply_language, detected_language
  → Catalogue context injection (if intent = purchase query)
  → smart_leads INSERT
  → Escalation check (OOS / price negotiation → create escalation, notify rep)
  → Auto-reply decision (lib/autoReply.js):
      HIGH → manual review always
      MEDIUM → 30-min window (auto-dispatch unless rejected)
      LOW → auto-dispatch immediately (if tenant.auto_reply.enabled = true)
      disabled → manual review always
  → If not manual: responder.js (Claude Sonnet draft) → dispatch via outbox.js
  → If manual: draft → smart_interactions (outbound_draft) → /app/drafts approval UI
```

### Channel router (reply channel resolution)
Priority order:
1. `contact.preferred_channel` (explicit stored preference)
2. Explicit request detected in message text ("email me", "send via WhatsApp")
3. Originating channel (where the lead came from)
4. Tenant default channel (`tenants.settings.default_channel`)

### Dispatch (outbox.js)
Resolves channel+address, then routes:
- `whatsapp` → Meta Cloud API (`lib/metaSend`) with `@lid` device ID support via wwebjs fallback
- `email` → Resend (`lib/emailSend`)
- `instagram` / `messenger` / `sms` → Phase 2 (not implemented)
- `manual` / no address → hold in approval queue

### Stock movement (append-only)
Every stock change goes through `stock_movements` table.
- BEFORE INSERT trigger atomically updates `inventory.stock_count`
- Captures `stock_after` snapshot on the movement row
- BEFORE UPDATE / DELETE triggers raise exceptions (table is immutable)
- `stock_count` on `inventory` is always the computed live balance

### Escalation handoff
```
engine.js detects: OOS or price_negotiation flag in triage output
  → lib/escalation.js detectEscalation()
  → lib/escalationService.js createAndNotifyEscalation()
      → INSERT into escalations table
      → FLAG smart_leads.escalation_status = 'pending'
      → Push notification to rep (if push subscription exists)
      → Email to tenant owner
  → Rep updates outcome: pending → converted / rejected / stalled
  → lib/escalation.js validateOutcomeTransition() enforces state machine
  → Attribution dashboard: per-rep conversion rate
```

### Auth flow
```
User signs up → Supabase Auth creates user → registerWithAuth() creates tenant + user_tenants row
User logs in → Supabase sets session in cookies (via createBrowserClient)
Next.js middleware reads cookie via createServerClient → protects /app/* routes
Express backend validates JWT via requireAuth middleware → reads user_tenants → sets req.tenantId
DEV_BYPASS_AUTH=true → skips JWT, sets default tenant
```

---

## 4. Files, Folders, Tools, APIs, Systems

### Project root: `/Users/shyamachand/Documents/invisible-sales-os/`

#### Backend (Express, port 3001, ES modules)
```
server.js                    — Express gateway, all routes, WhatsApp + email pipeline wiring
controllers/
  auth.js                    — getMe, registerWithAuth
  billing.js                 — getPlans, getCurrentBilling, createCheckout (Stripe), handleStripeWebhook
  drafts.js                  — draft generation, approval, dispatch
  escalations.js             — create/list/update escalations, attribution endpoint
  invoices.js                — invoice CRUD, PDF download/upload, AI parse, quote conversion
  leads.js                   — lead CRUD, triage endpoint
  products.js                — catalogue CRUD, adjustStock, listMovements
  quotes.js                  — quote CRUD
  settings.js                — GET/PATCH auto-reply settings
  team.js                    — list/add/role/remove team members
  tenants.js                 — registration, onboarding status

lib/
  AI_Triage.js               — Claude Haiku triage (structured JSON output)
  authMiddleware.js          — requireAuth (JWT via Supabase) + requireInternalKey
  autoReply.js               — decideAutoReply(), validateAutoReplyConfig(), schema
  catalogue.js               — Zod schemas, computeStockChange, deriveStatusFromStock
  catalogueContext.js        — matchProducts keyword rank, formatCatalogueContext, getCatalogueContext
  channelRouter.js           — resolveReplyChannel() — 4-level preference cascade
  db.js                      — Supabase client singleton, checkLiveInventory
  emailListener.js           — IMAP ingestion (imapflow, 60s poll)
  emailSend.js               — Resend outbound (real, not stub)
  escalation.js              — detectEscalation, validateOutcomeTransition, summarizeAttribution
  escalationService.js       — createAndNotifyEscalation (push + email, dedupes pending)
  followUp.js                — stale lead follow-up (6h cron)
  invoiceParser.js           — invoice detection + AI field extraction
  invoicePdf.js              — A4 PDF generation (pdf-lib)
  metaSend.js                — Meta Cloud API WhatsApp dispatch
  outbox.js                  — unified dispatch router (routes channel → send fn)
  pushNotify.js              — VAPID web push for HIGH priority leads
  responder.js               — Claude Sonnet draft generation (with catalogueContext param)
  supabase.js                — Supabase client (anon key, for server use)
  team.js                    — validateRole, canRemoveMember, canChangeRole, isMember
  weeklyDigest.js            — Monday digest (Claude Haiku narrative + Resend)
  digestScheduler.js         — Monday 8am UTC cron, ISO week dedup
  autoReplySweeper.js        — background sweeper for MEDIUM window dispatch

agents/                      — Board member DNA files (read at session start)
  README.md
  ceo.md
  cto-ai.md
  product-lead.md
  database-lead.md
  revenue-lead.md
  security-lead.md
  gtm-lead.md
  customer-success.md

tests/                       — Vitest test suite (~279 tests, 26 files)
  autoReply.test.js          — 15 tests
  billing.test.js            — webhook tests included
  auth.test.js               — 13 tests
  catalogue.test.js          — 16 tests
  catalogueContext.test.js   — 12 tests
  escalation.test.js         — 13 tests
  outbox.test.js             — 9 tests
  responder.test.js          — 4 tests
  settings.test.js           — 9 tests
  team.test.js               — 11 tests
  [+ others]
```

#### Frontend (Next.js, port 3000)
```
frontend/src/
  app/
    page.tsx                 — Marketing landing page (walnut hero, pricing teaser)
    login/page.tsx           — Login (amber button, warm borders)
    signup/page.tsx          — Signup (Supabase auth.signUp flow)
    pricing/page.tsx         — 3 tiers, annual/monthly toggle, FAQ
    onboarding/
      setup/page.tsx         — 4-step wizard (confirm → WhatsApp QR → Brand DNA → celebrate)
      brand-dna/page.tsx     — Brand DNA configuration (linked from sidebar stopgap)
    app/
      dashboard/page.tsx     — Stat cards, recent leads, skeleton loading
      leads/page.tsx         — Leads list, search, filter, language badges
      drafts/page.tsx        — Approval UI (approve / edit / escalate)
      quotes/page.tsx        — Quote builder
      invoices/page.tsx      — Invoice list (All/Outbound/Inbound tabs)
      invoices/[id]/page.tsx — Invoice detail + PDF download
      invoices/new/page.tsx  — New invoice form
      catalogue/page.tsx     — Product catalogue (Direction C, CRUD + stock adjust)
      escalations/page.tsx   — Handoffs queue (rep assign, outcome buttons, attribution)
      billing/page.tsx       — Tier, trial countdown, usage bars
      settings/
        auto-reply/page.tsx  — Master toggle + per-priority rules + window
        team/page.tsx        — Team member management
        integrations/page.tsx — Integration status (nav link added to sidebar)
  components/
    layout/sidebar.tsx       — Walnut sidebar, 4 nav sections, amber active state
    AuthProvider.tsx         — React context, useAuth(), getAuthHeaders()
  lib/
    supabase.ts              — createBrowserClient from @supabase/ssr (NOT createClient)
    push.ts                  — push subscription helpers
  middleware.ts              — createServerClient, protects /app/* routes
```

#### Database (Supabase, project: `lmslyfxvvnvjojsymehy`)

Key tables:
```
tenants              — multi-tenant root. has auto_reply JSONB config, settings JSONB, stripe cols
smart_leads          — one row per lead. has contact_id, auto_reply_*, escalation_* cols
smart_interactions   — all messages (inbound + outbound drafts)
contacts             — contact entity (one person, many channels). preferred_channel + channels JSONB
inventory            — product catalogue (extended). stock_count is live balance.
stock_movements      — append-only stock audit. trigger updates inventory.stock_count.
escalations          — escalation records linked to leads
user_tenants         — maps auth.uid() → tenant_id + role
lead_activities      — event log per lead (type CHECK extended for escalation + catalogue)
ai_learning          — tracks draft edits and outcomes for few-shot learning
invoices             — outbound + inbound invoices
quotes               — quotes with line_items JSONB
push_subscriptions   — VAPID endpoints per tenant device
email_threads        — IMAP thread tracking
segments / segment_runs — broadcast segments (WARNING: WhatsApp ban risk if misused)
call_logs            — logged calls linked to leads
brand_dna            — brand voice + successful_examples JSONB (few-shot)
company_knowledge    — pgvector embeddings for company knowledge (vector col)
```

Migrations applied (in order):
1. `add_composite_indexes` — 7 composite indexes
2. `add_soft_delete_columns` — deleted_at on smart_leads, invoices
3. `add_tenant_metadata_columns` — owner_email, subscription_tier, trial_started_at, settings
4. `harden_rls_policies` — replaced USING(true) with structured per-command policies
5. `rebuild_tenant_metrics_view` — soft-delete aware
6. `add_user_tenants_and_fix_closed_deals` — user_tenants table, closed_deals.tenant_id
7. `add_updated_at_triggers` — auto-update triggers on key tables
8. `auth_scoped_rls_policies` — auth_tenant_id() SECURITY DEFINER function, all RLS updated
9. `add_stripe_columns_to_tenants` — stripe_customer_id, stripe_subscription_id
10. `phase1_contacts_and_auto_reply` — contacts table, smart_leads contact_id + auto_reply cols, tenants.auto_reply JSONB
11. `phase1_catalogue_and_escalation` — extends inventory (reorder_point, is_active, currency, category, deleted_at, updated_at), creates stock_movements (append-only with triggers), adds smart_leads escalation cols, extends lead_activities.type CHECK
12. `phase1_retire_legacy_inventory` — legacy inventory retired, db.js repointed
13. `phase1_team_members_and_activity_actor` — lead_activities.actor_user_id, get_tenant_members fn, get_user_id_by_email fn
14. `phase1_escalations_and_outcome_tracking` — escalations table, smart_leads escalation_status/escalated_at
15. `phase1_catalogue_products_stock` + `phase1_rebuild_stock_movements_for_products` — products table (canonical), stock_movements rebuilt for products

Helper functions in Postgres:
- `auth_tenant_id()` — SECURITY DEFINER, maps auth.uid() → tenant_id via user_tenants
- `set_updated_at()` — generic updated_at trigger function
- `apply_stock_movement()` — SECURITY DEFINER BEFORE INSERT trigger on stock_movements
- `prevent_stock_movement_mutation()` — raises exception on UPDATE/DELETE of stock_movements
- `get_tenant_members(UUID)` — SECURITY DEFINER, returns team members for a tenant
- `get_user_id_by_email(TEXT)` — SECURITY DEFINER, looks up auth.users by email

#### External APIs / Services
| Service | Used for | Key env var |
|---------|----------|-------------|
| Anthropic (Claude) | Triage (Haiku), drafts (Sonnet), invoice parse (Haiku), digest (Haiku) | `ANTHROPIC_API_KEY` |
| Supabase | DB, Auth, Storage (invoice PDFs), RLS | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Meta Cloud API | WhatsApp outbound (production path) | `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN` |
| whatsapp-web.js | WhatsApp inbound listener + @lid fallback outbound | `wwebjs` npm package |
| Resend | Email outbound | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| imapflow | Email inbound (IMAP polling) | `EMAIL_IMAP_*` env vars |
| Stripe | Subscription billing | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| VAPID (web push) | Push notifications for HIGH leads | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` |
| pdf-lib | Invoice PDF generation (server-side) | npm package |

---

## 5. Prompts and Instructions That Worked Well

### Board agent system
Loading agent files from `agents/` at the start of each session gives the AI the standing opinions, decisions, and open questions for each board role. The board pushes back — rubber-stamping is explicitly prohibited. This produced better feature decisions than open-ended feature requests.

Pattern that worked: _"All board members respond with full opinions. Be opinionated, push back, flag risks."_

### Feature requests with rationale
Shyama's feature requests land better when framed as: _"Here is the problem, here is the commercial reason, here is what I want."_ The board then debates implementation. Requests without rationale tend to get pushed back.

### Security-first framing
Flagging the Security Lead as having veto power over production deployments meant security issues were caught before being coded, not after. The pattern: _"Security Lead reviews every new API route proposal before it goes in."_

### Rule #1 enforcement
Making "no code without a test" a named rule with teeth (the board references it explicitly) worked. Tests were written alongside every controller, not after.

### Migration naming convention
Named migrations by feature (`phase1_catalogue_and_escalation`) rather than timestamps. This makes the migration log human-readable.

---

## 6. Assumptions Made

| Assumption | Implication if wrong |
|------------|---------------------|
| Lala businesses use WhatsApp as their primary sales channel | Entire ingestion architecture needs rethinking |
| UK launch, GBP only | Multi-currency refactor needed at scale |
| First clients will be from Shyama's personal network (high trust, low friction to onboard) | CAC assumptions change if outbound GTM is needed |
| Supabase shared-table multi-tenancy scales to early customer count | May need schema-per-tenant at 100+ clients |
| Meta Cloud API is the production WhatsApp path (wwebjs is dev/fallback only) | Meta API approval and phone number verification required per client |
| Stock can go negative (adjustments correct errors) | Application layer must check OOS before confirming quotes |
| `auth_tenant_id()` SECURITY DEFINER function correctly maps auth.uid() → tenant | If Supabase Auth is not used (e.g. API key auth), RLS breaks |
| Claude Haiku is fast and cheap enough for every inbound message | Cost model holds at scale — review at 10k leads/mo |
| `stock_movements` trigger runs SECURITY DEFINER so it can update inventory despite RLS | Trigger owner must have correct privileges on Supabase |
| `@lid` device IDs (wwebjs contacts) are correctly filtered and not blocked by the @lid guard | The @lid guard was patched twice already — fragile |

---

## 7. Things Expected to Continue in Future Sessions

### Phase 1 — In progress / next up
- [ ] **Channel router tests** — `lib/channelRouter.js` needs unit tests
- [ ] **Generic form webhook** — `POST /webhook/lead` with Zod validation, rate limiting (express-rate-limit), signed webhook secret per source. Receives Tally / Typeform / Google Forms payloads, normalises to lead schema.
- [ ] **`tenant_integrations` table** — encrypted third-party API credentials (Shopify etc). Service-role-only access (no frontend RLS). Application-level AES-256 encryption of `credentials` JSONB column before insert.
- [ ] **Auto-reply sweeper for wwebjs** — MEDIUM window leads dispatched via wwebjs are currently held in approval queue because the sweeper uses Meta-only outbox. Fix: sweeper needs access to the wwebjs `client` reference.
- [ ] **Email → email reply routing** — parser defaults `preferred_channel` to 'whatsapp' even for email-origin leads. Fix: default reply to source_channel when no explicit preference is stored.
- [ ] **`/app/settings/brand-dna` page** — currently linked to `/onboarding/brand-dna` as a stopgap. A proper in-app settings page is needed.
- [ ] **Stock `embedding vector(1536)` column** — deferred from migration. Add when pgvector semantic catalogue search is wired up. Use `hnsw` index with `vector_cosine_ops`.

### Phase 2 — After first paying client
- [ ] **Catalogue API pull** — Shopify / WooCommerce webhook receivers. Stock sync. Credentials stored in `tenant_integrations`.
- [ ] **Instagram DMs** — Meta Graph API. Requires client's Instagram Business account + Facebook Page + Meta Business Manager. Legal: GDPR consent basis review before building.
- [ ] **Facebook Messenger** — Bundle with Instagram channel activation.
- [ ] **Email as full two-way equal channel** — IMAP ingestion is live. Reply via Resend on same thread. The outbox already handles this — what's missing is thread continuity (reply-to threading).
- [ ] **Live stock dashboard** — Real-time stock page with low-stock alerts. After catalogue foundation is stable.
- [ ] **WhatsApp session isolation** — Currently one shared wwebjs session. Each tenant needs their own isolated session directory and QR scan.

### Phase 3 — Validate on enterprise clients first
- [ ] **CRM integrations** — HubSpot, Salesforce, Pipedrive. One integration = 2-3 months. Do not start without a named enterprise client asking for a specific CRM by name.
- [ ] **pgvector semantic lead deduplication** — Same buyer contacts from two different phone numbers. Requires embedding pipeline.
- [ ] **Annual billing** — 2 months free (17% discount). Billing infrastructure needs Stripe subscription update logic.
- [ ] **Referral programme** — £20 credit per referred client. Shyama likes this idea. Phase 3.

### Ongoing / never fully done
- [ ] **Stripe webhook secret** — `STRIPE_WEBHOOK_SECRET` is empty in `.env.local`. Needs `stripe listen --forward-to localhost:3001/webhook/stripe` for local testing or Stripe Dashboard webhook for production.
- [ ] **Email IMAP activation** — `EMAIL_IMAP_ENABLED=false`. Set to `true` + configure `EMAIL_IMAP_USER` / `EMAIL_IMAP_PASS` when ready.
- [ ] **Supabase service role key** — `SUPABASE_SERVICE_ROLE_KEY` not yet in `.env.local`. Required for `tenant_integrations` and any service-role DB operations.
- [ ] **Real user auth in production** — `DEV_BYPASS_AUTH=true` is currently set. Must be removed before first paying client. Shyama needs to create a Supabase Auth account at `/signup` first.
- [ ] **Board agent files** — Should be updated at the end of every significant sprint. Each file has a "Last updated" section.
- [ ] **GTM pack** — Pitch deck, demo script, first client outreach. Deferred until product design is complete.

---

## 8. Edge Cases, Risks, and Failures Discussed

### Bugs that were fixed (learn from these)

**Login infinite redirect (critical):**
- Root cause: `frontend/src/lib/supabase.ts` used `createClient` from `@supabase/supabase-js` → session stored in localStorage. Next.js middleware used `createServerClient` from `@supabase/ssr` → reads from cookies. Cookies were always empty → redirect loop.
- Fix: Changed to `createBrowserClient` from `@supabase/ssr` which writes to both cookies AND localStorage.
- Rule: Never mix `@supabase/supabase-js` (client only) with `@supabase/ssr` middleware without ensuring the same session storage mechanism.

**Server not found (common mistake):**
- Root cause: `cd invisible-sales-os` executed from inside `frontend/` directory.
- Fix: Always `cd /Users/shyamachand/Documents/invisible-sales-os` (absolute path, project root).

**@lid filter bug (twice):**
- wwebjs contacts have device-local `@lid` identifiers. A filter was blocking real contacts.
- Was patched twice. The @lid handling in the WhatsApp listener is fragile — treat any changes there carefully.

**autoReplySweeper column name error:**
- Sweeper queried `smart_leads.preferred_channel` which doesn't exist. The column is `communication_preference`.
- Was spamming errors every 60s until caught. Always verify column names against actual schema before writing queries.

**Stripe webhook body parsing:**
- `express.raw({ type: 'application/json' })` on the webhook route MUST be registered before `app.use(express.json())`. If json() runs first, it parses the body, Stripe signature verification fails.
- The webhook route in `server.js` must stay above the global json middleware.

**Vitest + Stripe module scope:**
- `billing.js` initialises Stripe at module scope. `STRIPE_SECRET_KEY` must be present before import.
- Fix: `tests/setup.js` loads `.env.local` via dotenv, added to `vitest.config.js` as `setupFiles`.

**pgvector index without dimensions:**
- `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` fails if the column is `vector` without specified dimensions.
- Fix: Embed the embedding column addition and HNSW index together in a separate migration, specifying `vector(1536)` on the column.

### Standing risks

| Risk | Severity | Status |
|------|----------|--------|
| RLS is open until auth is hardened | Critical | Auth sprint complete but `DEV_BYPASS_AUTH=true` in dev |
| One client's data visible to another if RLS misconfigured | Critical | Mitigated by auth_tenant_id() + per-command policies |
| WhatsApp ban via broadcast campaigns | Existential | Cut from backlog. Do not build. |
| wwebjs unofficial API deprecation | High | Meta Cloud API is primary path. wwebjs is fallback only. |
| @lid device contacts fail Meta Cloud API dispatch | Medium | outbox.js routes @lid via wwebjs client. Fragile. |
| `stock_movements` trigger runs as SECURITY DEFINER | Medium | Correct behaviour, but changes to Supabase ownership model could break it |
| Third-party API keys in plaintext if added to `tenants.settings` | High | Must use `tenant_integrations` table (service-role only, no frontend RLS) |
| Instagram/Facebook DMs + GDPR consent basis | High | Legal review required before building |
| No rate limiting on public endpoints | Medium | `express-rate-limit` not yet added. Required before public launch. |
| No audit log for financial mutations | Medium | Invoices and quotes can be mutated without trace. Required before real money flows. |
| WhatsApp session not isolated per tenant | High | One shared wwebjs session in dev. Multiple tenants on same session = data leakage. |

---

## 9. Critical Environment Variables

```bash
# AI
ANTHROPIC_API_KEY=sk-ant-...

# Database
SUPABASE_URL=https://lmslyfxvvnvjojsymehy.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # NOT YET SET — needed for tenant_integrations

# Frontend (browser-safe)
NEXT_PUBLIC_SUPABASE_URL=https://lmslyfxvvnvjojsymehy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Internal security (server-side only — NEVER NEXT_PUBLIC_)
INTERNAL_API_KEY=f89bedea...

# WhatsApp
WHATSAPP_PHONE_ID=1212101891979892
WHATSAPP_ACCESS_TOKEN=EAG...
META_WEBHOOK_VERIFY_TOKEN=invisible_os_secure_2026

# Email
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=onboarding@resend.dev
EMAIL_IMAP_ENABLED=false           # Set true + configure below to activate
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_USER=your@gmail.com
EMAIL_IMAP_PASS=your-16-char-app-password

# Stripe (test keys set, live keys needed before production)
STRIPE_SECRET_KEY=sk_test_51Tn50t...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51Tn50t...
STRIPE_WEBHOOK_SECRET=             # EMPTY — needs stripe listen or Dashboard webhook

# Push
VAPID_PUBLIC_KEY=BMj1Qu_...
VAPID_PRIVATE_KEY=phRC46...
VAPID_EMAIL=mailto:shyamachand42@gmail.com

# Multi-tenancy
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
BACKEND_URL=http://127.0.0.1:3001
BACKEND_PORT=3001

# Dev bypass (REMOVE before production)
DEV_BYPASS_AUTH=true
```

---

## 10. How to Start a New Session

```bash
# Backend
cd /Users/shyamachand/Documents/invisible-sales-os
pkill -f "node server.js" 2>/dev/null; sleep 1 && node server.js

# Frontend (separate terminal)
cd /Users/shyamachand/Documents/invisible-sales-os/frontend
npm run dev

# Tests
cd /Users/shyamachand/Documents/invisible-sales-os
npm test
```

At session start, read:
1. `MEMORY.md` — index of all memory files
2. `agents/` — load board member files relevant to the sprint
3. `project_state.md` — current build state and next priorities
4. This file — for deep context on any topic

Board agent files are authoritative on their domain. The board pushes back. Rubber-stamping is not permitted.

---

## 11. Pricing Model

| Tier | Price | Seats | Key limit |
|------|-------|-------|-----------|
| Starter | £49/mo | 1 user | 1 channel, manual catalogue, 500 leads/mo |
| Growth | £149/mo | 5 users | 3 channels, catalogue API pull, invoices |
| Enterprise | £399/mo | Unlimited | Unlimited channels + CRM + white-label |

Trial: 14 days free on Growth tier. Converts to Starter if no card added.
Annual discount: 2 months free (17%) — planned but not yet built.

Stripe is wired in test mode. Switch `sk_test_` → `sk_live_` and add `STRIPE_WEBHOOK_SECRET` before going live.

---

_Last updated: 2026-06-30. Update this file at the end of major sprints._
