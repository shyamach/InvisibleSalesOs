# Migration Bridge — Session 1 → Session 2 (read me first)

_Purpose: orient Claude Code when picking up Invisible Sales OS. This is a short bridge; the full state lives in `SESSION_2_CURRENT_STATE.md`._

---

## 1. How Session 1 connects to Session 2

**Session 1 built the base product.** WhatsApp AI pipeline (triage → draft → human approval → dispatch), email IMAP ingestion, invoices, quotes, auth (Supabase + `DEV_BYPASS_AUTH`), Stripe, multi-tenancy with RLS, weekly digest, the Direction-C redesign, and ~145 tests. That core loop is still the product's spine and is protected above all else.

**Session 2 expanded it into the "8-pillar" vision and hardened the live path.** It added a contact entity model, an auto-reply approval-window system, a channel router, a unified dispatch layer (with real email), a generic form webhook, a live-stock catalogue with AI context injection, sales-rep handoff + outcome tracking, an auto-reply settings UI, employee/team accounts, and then wired the **live WhatsApp handler** to use this new intelligence. It also retired legacy pieces that the new model replaced.

The relationship: **Session 2 is additive and corrective, not a rewrite.** It builds on Session 1's tables, controllers, and engine, while reversing a handful of Session 1 behaviours that didn't fit the expanded vision (see §3). Test count went 145 → **279**.

---

## 2. Which Session 1 decisions are STILL VALID

- **Core loop is sacred:** inbound message → AI triage → lead saved → draft generated → (now: auto-reply gate) → human approval/dispatch → activities logged.
- **Rule #1:** no code without a Vitest test. **Rule #2:** lead triage returns structured JSON.
- **ES modules only** (`import/export`), **no raw `pg`** — all DB access via the Supabase client (`lib/supabase.js`).
- **`INTERNAL_API_KEY` is server-side only** — never `NEXT_PUBLIC_`. Frontend reaches the backend through `src/app/api/*` proxy routes that attach the key.
- **Migrations are applied via the Supabase MCP `apply_migration`** and logged in `DB_AUDIT_REPORT.md`.
- **Multi-tenancy via RLS** with the dev-fallback tenant `00000000-0000-0000-0000-000000000001` on every policy.
- **Soft delete** on financial/lead records (`deleted_at`).
- **Product Lead cut list still in force:** broadcast campaigns, invoice accounting (P&L/tax), multi-currency, pipeline kanban, segment broadcasts — all still deferred.
- **Security Lead veto still in force:** auth hardening + encrypted third-party key storage required before any paying client.
- **Run commands unchanged:** backend `node server.js` from repo root; frontend `cd frontend && npm run dev`.

---

## 3. Which Session 1 decisions were CHANGED or REPLACED

| Session 1 | Session 2 (current) |
|---|---|
| Engine **always auto-dispatched** after drafting | **Approval-first.** Dispatch is gated by the auto-reply decision; default `tenants.auto_reply.enabled = false` → everything waits for human approval. HIGH is **always** manual. |
| Email outbound was a **stub** (`"SMTP Relay queued for simulation"`) | **Real email** sending via Resend, through the rewritten router-driven `outbox.js`. Email is a co-equal channel. |
| `inventory` table was the catalogue store | **Retired and dropped.** `products` is now canonical; `db.js checkLiveInventory` repointed to `products`. A pre-existing empty `stock_movements` orphan (FK'd to `inventory`) was dropped and rebuilt as an append-only ledger bound to `products`. |
| Parser defaulted `preferred_channel` to `whatsapp` | Returns **`null` unless explicitly requested**, so replies are channel-symmetric (email-origin → email) via the channel router. |
| Live WhatsApp handler only **queued drafts** for manual approval | Still queues by default, but now also **injects catalogue context**, **records the auto-reply decision**, **auto-sends LOW** via the in-scope whatsapp-web.js `client` (handles `@lid`), and **creates escalations**. |
| Sidebar nav from Session 1 | Brand DNA link repointed (it pointed at a non-existent page); Integrations added to nav; Catalogue/Handoffs/Auto-reply/Team added. |

Nothing from Session 1 was fully *abandoned*; the above are behavioural replacements.

---

## 4. Current source of truth

Read in this order; **on any conflict, the earlier item wins:**

1. **`SESSION_2_CURRENT_STATE.md`** — authoritative current state (status, files, blockers, next steps).
2. **This file (`MIGRATION_BRIDGE.md`)** — what carried over vs changed.
3. **`DB_AUDIT_REPORT.md`** — the live schema's truth: migrations 1–11, table/column/RLS details.
4. **`agents/product-lead.md`** — running product development log + standing verdicts; other `agents/*.md` are authoritative on their domain.
5. **The persisted memory `MEMORY.md` index** (auto-loaded) — points to project_state and feedback notes.
6. **The code + `npm test`** — ultimate ground truth for behaviour.

Treat older session notes as history, not instructions, where they disagree with the above.

---

## 5. The exact next action Claude Code should take

1. `npm test` from the repo root. **Expect 279 passing across 26 files.** If anything is red, stop and fix before building.
2. Read `SESSION_2_CURRENT_STATE.md` (full state) and skim `DB_AUDIT_REPORT.md` (migrations 1–11).
3. Verify DB invariants: `brand_dna` id=1 has `tenant_id = 00000000-0000-0000-0000-000000000001`; the dev tenant exists; `products` may be empty (expected).
4. Then start the **top of the resume queue: timed-window WhatsApp auto-send** — let MEDIUM "window" drafts auto-send after the window by giving the auto-reply sweeper a WhatsApp sender that can reach `@lid` device IDs (the Meta-only `outbox` path can't). Build it test-first.
   - **Exception:** if the user has just added `SUPABASE_SERVICE_ROLE_KEY` or an embeddings key (`VOYAGE_API_KEY`), do that unblocked item instead (employee invite-new-user, or pgvector semantic match).

---

## 6. What Claude Code MUST AVOID

- **Do not rewrite the live whatsapp-web.js handler in `server.js` to call `engine.js`.** It was deliberately *augmented*, not replaced, to preserve its richer features (language detection, `ai_learning`, `lead_activities`, invoice detection, contact-name fallback). Add to it; don't swap it.
- **Do not auto-send via the Meta API to `@lid` device IDs** — it cannot deliver to them. Use the whatsapp-web.js `client` for those (that's why LOW auto-send lives inline in the handler).
- **Do not re-introduce or write to the `inventory` table** — it's retired. Use `products` / `stock_movements`.
- **Do not flip `tenants.auto_reply.enabled` to `true` by default**, and do not make HIGH-priority leads anything but manual — approval-first is intentional and safe.
- **Do not write code without a test** (Rule #1) or apply a migration without logging it in `DB_AUDIT_REPORT.md`.
- **Do not expose `INTERNAL_API_KEY`, the service-role key, or any secret to the browser** (no `NEXT_PUBLIC_`), and don't hardcode credentials.
- **Do not create speculative tables/migrations** for features not being built this pass (the DB Lead blocks unused schema).
- **Do not build the blocked items without their keys** (employee invite-new-user needs the service-role key; pgvector needs an embeddings key) — and don't fetch blocked web content via shell/Python workarounds.
- **Do not treat `UPDATE`/`DELETE` on `stock_movements` as available** — it's an immutable append-only ledger (no such RLS policies).
- **Do not assume in-memory rate limiter / sweeper are multi-instance safe** — single-process only until the security backlog addresses it.
