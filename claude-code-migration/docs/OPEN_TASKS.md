# Open Tasks — Invisible Sales OS (Claude Code migration)

_Source of truth: this file + `SESSION_2_CURRENT_STATE.md` + `MIGRATION_BRIDGE.md`. Where Session 1 notes conflict with this, **this wins.** Last updated 2026-06-30._

Baseline: **308 tests passing, 27 Vitest files.** Phase 1 (8-pillar expansion) is essentially complete; what remains are two key-blocked items and the pre-launch security backlog.

---

## 0. What Claude Code should do FIRST (before any task)

1. `npm test` from repo root → **expect 308 passing across 27 files.** If red, stop and fix before building anything.
2. Read `SESSION_2_CURRENT_STATE.md` (full state) → skim `DB_AUDIT_REPORT.md` (migrations 1–11) → `agents/product-lead.md` (dev log).
3. Verify DB invariants: `brand_dna` id=1 has `tenant_id = 00000000-0000-0000-0000-000000000001`; dev tenant exists; `products` may be empty (expected).
4. Then start **§2 (Current Top Priority)** — unless the user has just added a blocked key (see §5 Blockers), in which case do that unblocked item first.
5. Honour **Rule #1** (no code without a test) and **Rule #2** (triage returns structured JSON) on every change; log any new migration in `DB_AUDIT_REPORT.md`.

---

## 1. COMPLETED TASKS

- [x] **Timed-window WhatsApp auto-send for @lid targets** _(2026-06-30, 287/287 passing)_
  `isLidAddress` + `makeDispatch` added to `lib/autoReplySweeper.js`; `startAutoReplySweeper` now accepts `{ whatsappSender }` and routes `@lid` addresses via the wwebjs client instead of Meta Cloud API. One-line wire in `server.js`. 8 new tests. See `docs/SESSION_NOTES.md` for full detail.

- [x] **Catalogue CSV import — `POST /api/products/import`** _(2026-06-30, 308/308 passing — functionally complete; auth-sprint-dependent for full tenant isolation — see §5 security follow-up)_
  Pure CSV parser + formula-injection sanitizer in `lib/productImport.js` (21 tests); dedicated multer middleware + controller in `controllers/productImport.js`; Next.js proxy at `frontend/src/app/api/products/import/route.ts`; "Import CSV" button + result modal on `/app/catalogue` page. XLSX + `POST /webhook/products` deferred to Phase 2. See `docs/SESSION_NOTES.md` for full detail.

---

## 2. CURRENT TOP PRIORITY

**pgvector semantic catalogue match** _(blocked — needs embeddings key)_ — add `products.embedding`, embed on create/update, swap `lib/catalogueContext.getCatalogueContext` to an RPC vector match with the existing keyword match as fallback.

If `VOYAGE_API_KEY` is still unavailable, the unblocked top pick is:

**Employee invite-NEW-user flow** _(blocked — needs `SUPABASE_SERVICE_ROLE_KEY`)_ — Supabase admin `inviteUserByEmail` + auto-link to tenant on signup; then thread `actor_user_id` through activity logging so per-user attribution actually populates.

If both keys are unavailable, next unblocked item is:

**Security backlog — webhook + functions hardening** (Task 3.2 below — fully unblocked).

---

## 3. NEXT TASKS (in order)

1. **pgvector semantic catalogue match** _(blocked — needs embeddings key)_ — add `products.embedding`, embed on create/update, swap `lib/catalogueContext.getCatalogueContext` to an RPC vector match with the existing keyword match as fallback.
2. **Security backlog — webhook + functions hardening** — per-source signed HMAC secrets for `/webhook/lead` (currently one shared `WEBHOOK_SECRET`); tighten the SECURITY DEFINER fns `get_tenant_members` / `get_user_id_by_email` to caller-scoped (currently anon-grantable, only API-key gated).
3. **Security backlog — secrets + scale** — encrypted storage for third-party API keys via Supabase Vault (not JSONB `settings`); Redis-backed rate limiter + sweeper coordination for multi-instance.
4. **Employee invite-NEW-user flow** _(blocked — needs service-role key)_ — Supabase admin `inviteUserByEmail` + auto-link to tenant on signup; then thread `actor_user_id` through activity logging so per-user attribution actually populates.
5. **Proper in-app Brand DNA settings page** — replace the stopgap nav link to `/onboarding/brand-dna` with `/app/settings/brand-dna` (view/edit brand_name, voice, tone). Needs a GET path for brand_dna.
6. **Integrations page completion** — wire the email IMAP/SMTP form to persist; add Tally and manual-upload channel cards alongside the existing WhatsApp QR panel.
7. **Conversation/activity analytics** — counts per lead/channel/rep from `smart_interactions` + `lead_activities` (cheap, no new deps; groundwork for the calendar idea).

---

## 4. Tasks that should WAIT until later (Phase 2 / gated)

- **`POST /webhook/products` external catalogue sync** — Phase 2. Gate on: (a) per-tenant webhook token design exists (a `webhook_tokens` table — token hash → tenant_id, server-side only, never from request body); (b) a confirmed client/integration need is named (e.g. Shopify, WooCommerce, Google Sheets sync). Security Lead vetoed the optional-secret + caller-controlled tenant_id pattern; any implementation must use server-side token lookup. Do not revive without both gates met.
- **Google + Microsoft social login** (Supabase OAuth) — needs provider credentials; do alongside any calendar work.
- **Calendar + meeting booking** (Google Calendar / MS Graph) — useful at the handoff "book a call" moment, but needs OAuth + encrypted token storage (tied to the security backlog). Phase 2.
- **Instagram DMs + Facebook Messenger** (Meta Graph) — needs Meta Business verification + GDPR review.
- **SMS dispatch** — channel router/outbox return `unsupported_channel` for it today; wire when there's a provider.
- **CRM integrations (HubSpot/Salesforce)** — deferred until an enterprise client is confirmed.
- **Still-cut (Session 1, do NOT revive without client need):** broadcast/segment campaigns, invoice accounting (P&L/tax), multi-currency, pipeline kanban.

---

## 5. Risks & blockers

### Security follow-up — tenant scoping (system-wide, not Task 2 specific)

**Finding (2026-06-30, reviewed during Task 2):**
Every controller in the codebase resolves tenant identity via:
```js
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;
```
This header is **caller-controlled**. Any caller who obtains `INTERNAL_API_KEY` can set `x-tenant-id` to any tenant UUID and read or write that tenant's data. This affects all data-scoped endpoints: `/api/products`, `/api/escalations`, `/api/team`, `/api/settings`, and the new `/api/products/import`.

The Security Lead's requirement — "tenant_id from authenticated session context only" — is **not met** by `x-tenant-id` alone. It is currently met indirectly by the fact that `INTERNAL_API_KEY` is a server-only secret (never `NEXT_PUBLIC_`), so the attack surface is limited to the trusted Next.js server process. In single-tenant dev mode the header is not even sent; the backend falls back to `DEFAULT_TENANT_ID`.

**Required fix (unlocked by auth sprint):**
Once Supabase Auth middleware is in place and sets `req.tenantId` from a verified JWT, replace every `tenantOf(req)` call with `req.tenantId`. One change per controller, no schema changes. Until then, this is a known pre-launch gap tracked in the Security Lead's SHOWSTOPPER checklist (item 2: "No real authentication").

**Follow-up task (do after auth sprint):**
> Replace `x-tenant-id` header-based tenant scoping with `req.tenantId` (set by verified-JWT middleware) in all controllers: `products.js`, `escalations.js`, `team.js`, `settings.js`, `productImport.js`. The import endpoint (`POST /api/products/import`) and all other data-scoped endpoints are functionally complete but share this system-wide auth-sprint dependency.

**Scope:** This is pre-existing — present in every controller before Task 2. Task 2 (`productImport.js`) follows the same pattern and carries the same dependency. Safe to ship in dev/single-tenant; must be resolved before multi-tenant production.

---

- **BLOCKED — `SUPABASE_SERVICE_ROLE_KEY` not set:** required for employee invite-new-user (admin API). Until then only existing users can be added.
- **BLOCKED — no embeddings key:** `VOYAGE_API_KEY` (recommended) or OpenAI required for pgvector semantic match. Keyword match is the fallback.
- **Single-process assumptions:** in-memory rate limiter and the auto-reply sweeper assume one server instance; not multi-instance safe yet.
- **Security veto (pre-launch):** no paying client until auth hardening + encrypted third-party key storage are done (Session 1 decision, still in force).
- **Env gaps:** `STRIPE_WEBHOOK_SECRET` still empty; `WEBHOOK_SECRET` optional (enforces form-webhook secret when set).
- **Three inbound paths exist** (whatsapp-web.js listener, Meta webhook → engine, form webhook → engine) — when changing lead behaviour, check all three, and **do not** collapse the live whatsapp-web.js handler into the engine (it was deliberately augmented).

---

## 6. Guardrails (do NOT do)

- Don't rewrite the live whatsapp-web.js handler to call `engine.js` — augment it.
- Don't auto-send to `@lid` via Meta; use the whatsapp-web.js client.
- Don't use or recreate the retired `inventory` table — use `products` / `stock_movements`.
- Don't default `tenants.auto_reply.enabled` to true; don't make HIGH anything but manual.
- Don't treat `stock_movements` as mutable (append-only; no UPDATE/DELETE policies).
- Don't write code without a test, or apply a migration without logging it in `DB_AUDIT_REPORT.md`.
- Don't expose secrets to the browser (`INTERNAL_API_KEY`, service-role key — never `NEXT_PUBLIC_`).
- Don't build blocked items without their keys.
