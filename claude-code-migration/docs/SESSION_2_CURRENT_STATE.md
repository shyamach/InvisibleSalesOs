# Invisible Sales OS — Session 2 Current State (handoff for Claude Code)

_Last updated: 2026-06-28. Continuation of Session 1. This supersedes Session 1 where they conflict._

---

## 1. Current project status

Revenue-intelligence SaaS for wholesale/distribution SMEs ("Lala" companies). UK launch, GBP. Backend: Express (port 3001), Node ES modules. Frontend: Next.js (port 3000). DB: Supabase (project `lmslyfxvvnvjojsymehy`), RLS on all tables with a dev-fallback tenant `00000000-0000-0000-0000-000000000001`.

- **Tests: 279 passing, 0 failures, 26 Vitest files.** (`npm test`)
- **Phase 1 of the product-vision expansion is essentially complete** (items 1–7 of the build order). Follow-ups (auto-reply settings UI, employee accounts, legacy-inventory retirement) are done. Live WhatsApp has been wired to the new intelligence.
- Core loop works end-to-end through THREE inbound paths (see §4).
- Three workstreams remain, two are **blocked on keys the user must supply** (see §6).

---

## 2. What changed since Session 1

Session 1 delivered the base product (WhatsApp AI pipeline, email IMAP, invoices, quotes, auth, Stripe, multi-tenancy, digest, Direction-C redesign, 145 tests). Session 2 added:

### DB migrations applied this session (live, via Supabase MCP; logged in `DB_AUDIT_REPORT.md`)
6. `phase1_contacts_and_auto_reply` — `contacts` table (preferred_channel + channels JSONB, soft delete, RLS, updated_at trigger); `smart_leads.contact_id` + `auto_reply_decision` / `auto_reply_status` / `scheduled_dispatch_at`; `tenants.auto_reply` JSONB config.
7. `phase1_catalogue_products_stock` — `products` (canonical catalogue: sku, name, price, currency, stock_quantity, unit, status, soft delete, unique tenant+sku, RLS, trigger).
8. `phase1_rebuild_stock_movements_for_products` — dropped a pre-existing empty `stock_movements` orphan (FK'd to legacy `inventory`) and rebuilt it as an **append-only ledger** bound to `products` (delta, balance_after, reason; SELECT+INSERT-only RLS).
9. `phase1_escalations_and_outcome_tracking` — `escalations` table (reason, status state machine, assigned_to/name, deal_value, RLS, trigger); `smart_leads.escalation_status` + `escalated_at`.
10. `phase1_retire_legacy_inventory` — dropped the legacy `inventory` table; `db.js checkLiveInventory` repointed to `products`.
11. `phase1_team_members_and_activity_actor` — `lead_activities.actor_user_id`; SECURITY DEFINER fns `get_tenant_members(uuid)` and `get_user_id_by_email(text)` (read members + emails without a service-role key).

### Backend features added
- **Auto-reply with approval window** — `lib/autoReply.js` (pure decision, returns structured JSON; HIGH always manual; disabled tenant = manual; LOW=auto, MEDIUM=window). Wired into `engine.js`. **`lib/autoReplySweeper.js`** dispatches scheduled drafts after the window unless rejected (60s interval, started in `server.js`).
- **Channel router** — `lib/channelRouter.js` (contact pref → explicit request → originating channel → tenant default → whatsapp fallback; address-aware; `deriveChannelFromSource` normalises raw origin tags). Wired into `outbox.js`.
- **Dispatch layer** — `outbox.js` rewritten as the single router-driven dispatch authority: WhatsApp via `lib/metaSend`, **email via `lib/emailSend` (now a real outbound channel, previously stubbed)**.
- **Generic form webhook** — `POST /webhook/lead` (`controllers/leadWebhook.js` + pure `lib/formLeadCore.js`), with Zod validation (`lib/webhookLeadSchema.js`) + rate limiting (`lib/rateLimiter.js`) + optional shared secret. Creates a contact, runs the engine, links lead→contact.
- **Catalogue** — `controllers/products.js` (CRUD + stock-adjust ledger + history), `lib/catalogue.js` (Zod + stock maths with no-oversell guard). AI catalogue context injection: `lib/catalogueContext.js` feeds real price/stock into drafts (wired into `engine.js` AND the live WhatsApp draft via `responder.js`).
- **Sales-rep handoff** — `lib/escalation.js` (OOS + price-negotiation detection, outcome state machine, attribution), `lib/escalationService.js` (create + push + email notify), `controllers/escalations.js`. Auto-fires from the engine and live WhatsApp.
- **Auto-reply settings API** — `controllers/settings.js` (`GET`/`PATCH /api/settings/auto-reply`).
- **Employee accounts** — `controllers/team.js` + `lib/team.js` (list/add-existing-by-email/role/remove; guards the last owner). `lead_activities.actor_user_id` for attribution.
- **Live WhatsApp augmentation** — the whatsapp-web.js `message_create` handler in `server.js` (a path separate from `engine.js`) now: injects catalogue context into drafts, records the auto-reply decision and **auto-sends LOW via the in-scope `client.sendMessage`** (reaches `@lid` device IDs Meta can't), and detects/creates escalations.

### Frontend added
- Pages: `/app/catalogue`, `/app/escalations` (Handoffs), `/app/settings/auto-reply`, `/app/settings/team`.
- Proxy routes under `src/app/api/` for products, escalations, settings/auto-reply, team.
- Sidebar: added Catalogue, Handoffs, Auto-reply, Team, Integrations; repointed Brand DNA.

### Bug fixes (from the user's runtime logs)
- `autoReplySweeper` queried non-existent `smart_leads.preferred_channel` (errored every 60s) → fixed to `communication_preference`.
- Sidebar "Brand DNA" linked to a non-existent `/app/settings/brand-dna` → repointed to `/onboarding/brand-dna` (stopgap).
- Integrations page existed but was not in the sidebar → added.

---

## 3. Latest decisions

- **Email is a co-equal channel** in Phase 1 (real outbound via Resend; symmetric reply routing).
- **Approval-first auto-reply.** `tenants.auto_reply.enabled` defaults to `false` → every draft waits for human approval until a tenant opts in. HIGH priority is **always** manual regardless of config.
- **`products` is the canonical catalogue**; legacy `inventory` retired.
- **`stock_movements` is an immutable append-only ledger** (no UPDATE/DELETE policies).
- **Employee invites:** until a service-role key exists, only EXISTING (already signed-up) users can be added to a tenant.
- **Live WhatsApp keeps its rich handler** (triage/language/ai_learning/activities/invoice detection) and was *augmented* with engine capabilities rather than replaced.

---

## 4. Current workflow / architecture

- **Three inbound lead paths:**
  1. **whatsapp-web.js listener** in `server.js` (`message_create`) — the live path; now augmented with catalogue context, auto-reply decision + LOW auto-send, escalation.
  2. **Meta webhook** (`controllers/whatsapp.js`) → `engine.js` (full intelligence).
  3. **Form webhook** (`controllers/leadWebhook.js`) → `engine.js`.
- **Engine** (`engine.js`): Brand DNA fetch → parse → score → catalogue context → draft → DB sync → auto-reply gate → escalation. Requires a `brand_dna` row with id=1 and `tenant_id` set (now linked to the dev tenant).
- **Non-negotiable rules:** Rule #1 — no code without a Vitest test. Rule #2 — lead triage returns structured JSON. ES modules only. No raw `pg` (Supabase client only). `INTERNAL_API_KEY` server-side only. Migrations via Supabase MCP `apply_migration`, then log in `DB_AUDIT_REPORT.md`. Pure logic in small `lib/` modules; controllers/handlers are thin glue.
- **Run:** backend `node server.js` (from repo root); frontend `cd frontend && npm run dev`. `DEV_BYPASS_AUTH=true`.

---

## 5. Current files and folders (key)

```
/ (backend root)
  server.js                     # Express app, routes, whatsapp-web.js live handler, schedulers
  engine.js                     # cognitive pipeline (auto-reply, catalogue, escalation wired in)
  outbox.js                     # router-driven dispatch (whatsapp + real email)
  parser.js  responder.js  db.js  AI_Triage.js
  DB_AUDIT_REPORT.md            # migration log (migrations 1–11)
  SESSION_2_CURRENT_STATE.md    # this file
  lib/
    autoReply.js  autoReplySweeper.js  channelRouter.js
    rateLimiter.js  webhookLeadSchema.js  formLeadCore.js
    catalogue.js  catalogueContext.js
    escalation.js  escalationService.js  team.js
    supabase.js  metaSend.js  emailSend.js  pushNotify.js  (+ existing libs)
  controllers/
    leadWebhook.js  products.js  escalations.js  settings.js  team.js
    whatsapp.js  email.js  invoices.js  billing.js  tenants.js  auth.js  calls.js  digest.js
  tests/                        # 26 files, 279 tests
    autoReply / channelRouter / autoReplySweeper / leadWebhook / rateLimiter /
    outbox / catalogue / catalogueContext / escalation / inventoryRepoint /
    settings / team / responder .test.js  (+ Session 1 tests)
  agents/                       # board member files; product-lead.md has a running dev log
  frontend/src/
    app/app/{catalogue,escalations,settings/auto-reply,settings/team}/page.tsx
    app/api/{products,escalations,settings/auto-reply,team}/...route.ts
    components/layout/sidebar.tsx
```

### Backend API surface added this session
- `POST /webhook/lead`
- `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/:id`, `POST /api/products/:id/stock`, `GET /api/products/:id/movements`
- `GET /api/escalations/attribution`, `GET/POST /api/escalations`, `PATCH /api/escalations/:id`
- `GET/PATCH /api/settings/auto-reply`
- `GET/POST /api/team`, `PATCH/DELETE /api/team/:userId`

---

## 6. Current blockers

1. **Employee invite-NEW-user** — needs `SUPABASE_SERVICE_ROLE_KEY` (Supabase admin API). Until then, only existing users can be added.
2. **pgvector semantic catalogue match** — needs an embeddings-provider key (`VOYAGE_API_KEY` recommended, or OpenAI). Currently keyword match; infra (pgvector ext, `company_knowledge.embedding`) is present.
3. **Timed-window auto-send on WhatsApp** — MEDIUM "window" drafts don't auto-send on WhatsApp. The 60s sweeper runs outside the whatsapp-web.js process and dispatches via Meta, which can't reach `@lid` device IDs. Needs the sweeper wired to the wweb client (or a wweb sender abstraction). LOW auto-send already works (sent inline from the handler).
4. **Security backlog before any paying client** (Security Lead veto): per-source signed HMAC webhook secrets (currently one shared `WEBHOOK_SECRET`); encrypted storage for third-party API keys (Supabase Vault, not JSONB); tighten `get_tenant_members` / `get_user_id_by_email` to caller-scoped (currently anon-grantable, only API-key gated); Redis-backed rate limiter + sweeper for multi-instance.
5. **Env still empty:** `STRIPE_WEBHOOK_SECRET`. Optional: `WEBHOOK_SECRET` (enforces form-webhook secret).

---

## 7. Current next steps (resume queue, in priority order)

1. **Timed-window WhatsApp auto-send** — let MEDIUM "window" drafts auto-send after the window (wire the sweeper to a WhatsApp sender that handles `@lid`).
2. **Catalog manual CSV/XLSX upload + `POST /webhook/products`** — to populate the catalogue fast and support external sync.
3. **pgvector semantic catalogue match** (once an embeddings key is added) — `products.embedding` col, embed on create/update, swap `getCatalogueContext` to an RPC match with keyword fallback.
4. **Security backlog** (see §6.4) — required before external launch.
5. **Employee invite-new-user flow** (once service-role key added) + thread `actor_user_id` through activity logging.
6. **Proper in-app Brand DNA settings page** (replace the onboarding-wizard stopgap); wire Integrations email config to persist; add Tally + manual-upload channel cards.
7. Optional / Phase 2: Google + Microsoft social login (Supabase OAuth); calendar + meeting tracking (ties to handoff "book a call", needs OAuth + encrypted tokens).

---

## 8. Session 1 decisions changed / replaced / abandoned

- **Engine auto-dispatch → approval-first.** Session 1's engine always dispatched after drafting. Now gated by the auto-reply decision; default (`enabled:false`) holds everything for manual approval.
- **Email dispatch was a stub** (`"SMTP Relay queued for simulation"`) → replaced with real Resend sending via `outbox.js`.
- **`inventory` table** (Session 1 catalogue store) → **retired and replaced by `products`**; `db.js checkLiveInventory` repointed. A pre-existing empty `stock_movements` orphan was dropped and rebuilt.
- **Parser channel default** — Session 1's parser defaulted `preferred_channel` to `whatsapp`, breaking email-origin replies. Now returns `null` unless explicitly requested, so replies are channel-symmetric.
- **WhatsApp send path** — Session 1's live handler only ever queued drafts for manual approval; it now also auto-sends LOW and runs catalogue/escalation logic.
- **Not abandoned, still in force:** Session 1 cut list (broadcast campaigns, invoice accounting, multi-currency, etc.) stands. Security Lead's "auth hardening before external launch" veto still stands.

---

## 9. What Claude Code should do FIRST

1. `git status` / pull as needed, then `npm install` (no new deps beyond `zod`, already present) and **run `npm test` — expect 279 passing across 26 files.** If red, stop and diagnose before building.
2. Read, in order: this file → `DB_AUDIT_REPORT.md` (migrations 1–11) → `agents/product-lead.md` (running dev log) → the board agent files for the relevant domain.
3. Confirm DB invariants: `brand_dna` id=1 has `tenant_id = 00000000-0000-0000-0000-000000000001`; dev tenant exists; `products` may be empty (expected).
4. Start the servers and smoke-test the new surfaces (Catalogue, Handoffs, Auto-reply, Team) per the run instructions in §4.
5. Then pick up the resume queue (§7) starting with **timed-window WhatsApp auto-send**, unless the user has added a blocked key (service-role or embeddings), in which case do that unblocked item. **Honour Rule #1 (test-first) and Rule #2 (structured JSON) on every change, and log any new migration in `DB_AUDIT_REPORT.md`.**
```
