# Next Session Handoff — Invisible Sales OS

_Written: 2026-06-30. For the session starting tomorrow._

---

## 1. Test baseline

**308 tests passing, 27 Vitest files.** No failures. This is the number to confirm before touching anything.

```
npm test   # from /Users/shyamachand/Documents/invisible-sales-os
```

Expected output: `Tests  308 passed (308)` and `Test Files  27 passed (27)`. If it's red, stop and fix before building anything.

---

## 2. What was completed today (2026-06-30)

### Task 1 — Timed-window WhatsApp auto-send for @lid targets

MEDIUM-priority leads with an approval window were getting stuck in `scheduled` state because the 60-second sweeper dispatched via Meta Cloud API, which cannot deliver to `@lid` device-local identifiers used by whatsapp-web.js.

**Files changed:**
- `lib/autoReplySweeper.js` — added `isLidAddress(phone)` and `makeDispatch(whatsappSender, standardDispatch)` exports; updated `startAutoReplySweeper` to accept `{ whatsappSender }`
- `tests/autoReplySweeper.test.js` — 8 new tests (3 × `isLidAddress`, 5 × `makeDispatch`)
- `server.js` — one-line wire: `startAutoReplySweeper(supabase, { whatsappSender: (to, text) => client.sendMessage(to, text) })`

Before: 279 tests / 26 files. After: 287 tests / 26 files.

---

### Task 2 — Catalogue CSV import (`POST /api/products/import`)

The `products` table was empty with no fast path to populate it.

**Files created/changed:**
- `lib/productImport.js` — pure functions: `sanitizeCell`, `hasBinarySignature`, `parseCSVToRows`, `validateImportRow`, `MAX_FILE_BYTES` (2 MB), `MAX_ROWS` (2 000)
- `tests/productImport.test.js` — 21 new tests
- `controllers/productImport.js` — dedicated multer middleware (`csvUpload`) + `importProducts` controller
- `server.js` — one import line + one route (`POST /api/products/import`)
- `frontend/src/app/api/products/import/route.ts` — Next.js proxy; pipes raw `arrayBuffer` to backend (preserves multipart boundary)
- `frontend/src/app/app/catalogue/page.tsx` — "Import CSV" button in header + upload modal with created/skipped/error result card

Security constraints enforced: magic-byte check (rejects XLSX/PDF/PE), formula-injection stripping, `tenant_id` from server-side header only (never from CSV), dedicated multer instance, 2 MB / 2 000 row caps, duplicate SKU skip (not upsert).

XLSX support and `POST /webhook/products` were explicitly cut and deferred to Phase 2. See `docs/OPEN_TASKS.md §4`.

Before: 287 tests / 26 files. After: 308 tests / 27 files.

---

### Board agents installed

8 agent definition files installed at `.claude/agents/` (project-scoped):
`ceo.md`, `cto-ai.md`, `product-lead.md`, `database-lead.md`, `revenue-lead.md`, `security-lead.md`, `gtm-lead.md`, `customer-success.md`.

Originals at `agents/` (plain Markdown) are untouched. The `.claude/agents/` versions are the ones Claude Code picks up. Use them as reviewers before implementing any non-trivial task — select only the agents relevant to the task and explain why others were excluded.

---

## 3. Open security finding — tenant scoping (carry forward)

**What was found:** Every controller in the codebase resolves tenant identity from a caller-controlled HTTP header:

```js
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;
```

Any caller who holds `INTERNAL_API_KEY` can set `x-tenant-id` to any tenant UUID and read or write that tenant's data. Affected controllers: `products.js`, `escalations.js`, `team.js`, `settings.js`, `productImport.js`.

**Current exposure:** Low in practice. `INTERNAL_API_KEY` is server-only (never `NEXT_PUBLIC_`), so the browser cannot reach Express directly. In the current frontend the `x-tenant-id` header is not even sent to the import endpoint — the backend falls back to `DEFAULT_TENANT_ID`. Safe in single-tenant dev mode.

**Not a Task 2 regression.** This pattern was present in every controller before Task 2. Task 2 followed the existing convention correctly. It is already recorded as SHOWSTOPPER item 2 in the Security Lead's pre-launch checklist ("No real authentication").

**Required fix — unlocked by auth sprint only:**
Once Supabase Auth middleware exists and sets `req.tenantId` from a verified JWT, replace every `tenantOf(req)` call with `req.tenantId`. One change per controller, no schema changes needed.

**Status of Task 2:** Functionally complete. Auth-sprint-dependent for full tenant isolation in multi-tenant production.

---

## 4. Next priority

Check what keys are available first. The queue is:

| Priority | Task | Gate |
|---|---|---|
| 1 | pgvector semantic catalogue match | Needs `VOYAGE_API_KEY` (or OpenAI) |
| 2 | Employee invite-new-user flow | Needs `SUPABASE_SERVICE_ROLE_KEY` |
| 3 | Security backlog — webhook + functions hardening | **Fully unblocked** |
| 4 | Security backlog — secrets + scale | Fully unblocked |
| 5 | Brand DNA settings page (`/app/settings/brand-dna`) | Fully unblocked |

**If both keys are unavailable tomorrow**, start with Task 3: security backlog — webhook + functions hardening. Specifically:
- Per-source signed HMAC secrets for `/webhook/lead` (currently one shared `WEBHOOK_SECRET`)
- Tighten `SECURITY DEFINER` fns `get_tenant_members` / `get_user_id_by_email` to caller-scoped

This is fully unblocked, test-first-able, and moves the pre-launch security checklist forward without requiring any new infrastructure.

Full task list with detail: `docs/OPEN_TASKS.md`.

---

## 5. First prompt to paste tomorrow

If the keys are still unavailable and you want to start on the security backlog:

```
Read docs/OPEN_TASKS.md and docs/SESSION_NOTES.md.

Run npm test first. Confirm 308/308 passing, 27 files.

Then plan — do not implement yet — the webhook hardening task (§3, task 2 in OPEN_TASKS.md):
per-source signed HMAC secrets for /webhook/lead and tightening the SECURITY DEFINER functions.

Select the relevant board agents, explain who is excluded and why, then get their reviews
before proposing an implementation plan. Wait for approval before writing any code.
```

If `VOYAGE_API_KEY` is available, replace the body with:

```
Read docs/OPEN_TASKS.md and docs/SESSION_NOTES.md.

Run npm test first. Confirm 308/308 passing, 27 files.

I now have VOYAGE_API_KEY. Plan — do not implement yet — the pgvector semantic catalogue match
(§3, task 1 in OPEN_TASKS.md). Select relevant agents, get reviews, then propose implementation.
Wait for approval before writing any code.
```

---

## 6. Do not touch without explicit approval

The following require stopping and asking before any changes — no exceptions, even if the change looks small:

| Area | Why |
|---|---|
| **Credentials / `.env.local`** | One wrong key has caused outages. Read but never write. |
| **Database migrations** | Every migration must be logged in `DB_AUDIT_REPORT.md` and reviewed by database-lead agent. `stock_movements` is append-only — no UPDATE/DELETE ever. |
| **Live WhatsApp client** | `client.sendMessage()` reaches real devices. Do not add auto-sends, change the wwebjs handler, or collapse it into `engine.js`. Augment only. |
| **Supabase production** | No direct SQL, no RLS changes, no policy edits without database-lead + security-lead agent decision. RLS USING clauses are currently `true` (known gap, not to be "fixed" unilaterally). |
| **Billing / Stripe** | `STRIPE_WEBHOOK_SECRET` is empty. Do not wire real billing flows or add Stripe webhook processing without explicit approval. |
| **Auth / RLS changes** | Auth sprint is a planned, structured sprint — not a place for incremental tinkering. Any auth-layer change needs security-lead + cto-ai agent review and explicit approval from Shyama. |
| **`inventory` table** | Retired. Do not reference, recreate, or migrate from it. Use `products` / `stock_movements`. |
| **Phase 2 items** | `POST /webhook/products`, social login, calendar, Instagram/Messenger, SMS, CRM integrations — do not revive without explicit instruction and the gates in `OPEN_TASKS.md §4` being met. |

---

## 7. Quick orientation for a cold start

```
Repo root:    /Users/shyamachand/Documents/invisible-sales-os/
Backend:      Express, port 3001 (node server.js or npm run dev:server)
Frontend:     Next.js, port 3000 (npm run dev from frontend/)
DB:           Supabase (credentials in .env.local — not committed)
Tests:        Vitest, run from repo root (npm test)
Agents:       .claude/agents/ (8 files — use as reviewers, not implementers)
Migration log: DB_AUDIT_REPORT.md (update it whenever a migration runs)
Context docs: claude-code-migration/docs/ — read SESSION_NOTES.md + OPEN_TASKS.md first
```

Agent operating rule: for each task, select only the agents relevant to that task, explain who is excluded and why, invoke them as reviewers, and do not implement until the plan is approved.
