> Copied verbatim from Claude Code plan-mode storage
> (`~/.claude/plans/mighty-discovering-treasure.md`) into repo docs as a
> docs-only audit record, per Command Room approval. Content below is
> unchanged from the original planning audit.

# Block 1.3 — Lane B System-Actor RPCs: Planning Audit

## Context

Block 1.1 migrated Lane A (user-facing) routes to `requireAuth` + `req.supabase` carrying a real
user JWT. Block 1.2a/1.2b fixed trusted tenant *derivation* for `/webhook/lead` and deliberately
deferred multi-channel tenant mapping until a second tenant/channel exists. Neither of those
blocks touched how Lane B (webhooks, cron jobs, background sweepers) actually *writes* to
tenant-scoped tables — every Lane B write today goes through the single module-level anon-key
Supabase client (`lib/supabase.js`), the same client an anonymous browser could hold, because the
project's `SUPABASE_ANON_KEY` is also what ships client-side.

This audit answers: where does Lane B write tenant-scoped data, what client/authority does it
write with, does RLS actually enforce anything for those writes today, and what's the smallest
safe system-actor pattern to introduce — without touching Decision Brain, RLS policies, tenant
derivation, or `DEFAULT_TENANT_ID` removal (all explicitly out of scope per the task brief).

The single biggest discovery: **this codebase has two independent, parallel lead-ingestion
pipelines that don't share a write path**, and the newer one (`engine.js` → `db.js`) has been
silently incapable of creating a new lead since the initial commit, because it never writes
`tenant_id` at all. The system currently "works" only because the older, duplicate pipeline
(inlined directly in `server.js`) is what's actually live for WhatsApp and email, and it happens
to hardcode the one tenant_id that exists. This is detailed in Section 4/5 below and reframes
what Block 1.3 needs to prioritize.

---

## 1. Executive Summary

- **Overall risk level: HIGH**, but not from an active exploit — from **structural fragility**.
  Nothing here is presently being abused (there is exactly one tenant, and by coincidence its
  `tenant_id` equals the hardcoded RLS dev-fallback literal `00000000-0000-0000-0000-000000000001`
  that every policy special-cases). The risk is that (a) one currently-live write path
  (`engine.js` → `db.js`) has been non-functional for creating **new** leads since the initial
  commit — RLS silently rejects it — and (b) the moment a second real tenant exists, most of
  Lane B breaks or cross-contaminates, because tenant identity is either hardcoded to the single
  fallback UUID or entirely missing from the write call.
- **Does Block 1.3 need migrations/RPCs?** Not for the immediate fix. The most severe finding
  (missing `tenant_id` in `db.js`) is a **pure app-layer plumbing bug** — the trusted tenant_id
  is already resolved in-memory in the caller (`engine.js`) and simply isn't threaded through.
  That is a **no-migration code fix**. A SECURITY DEFINER RPC / system-actor boundary *is*
  needed before this app can safely serve a **second** tenant through Lane B, because the
  current RLS INSERT policies only ever let the anon role write for one hardcoded UUID or (for
  the older, legacy-permissive tables) any non-null UUID at all with no identity check. That
  RPC work should be scoped as a later, approval-gated slice — see Section 8.
- **Does this need Command Room approval before implementation?** The no-migration code fix
  (thread `tenant_id` through `db.js`/`lib/supabaseLeads.js`/`lib/supabaseOutreach.js`) is safe
  to slice and implement without new approval beyond normal review, because it changes no schema,
  no RLS, and only makes existing calls pass values that are already trusted and already
  RLS-permitted for the one tenant that exists. Any SECURITY DEFINER RPC work is a new
  migration and does need Command Room sign-off, same as Block 0.1/0.2/0.3's RPCs did.
- **Immediate no-migration cleanup that exists:** yes — see Section 8, slice 1.3b.

---

## 2. Lane B/System Write Inventory Table

| Entry point / job | File / function | Tables written | Tenant source | Supabase client | RLS enforced or bypassed | Risk | Recommended action |
|---|---|---|---|---|---|---|---|
| Meta WhatsApp webhook | `controllers/whatsapp.js#processWhatsAppWebhook` → `engine.js` → `db.js#saveLeadAndLogToDatabase` | `smart_leads`, `smart_interactions` | **Never set** — `db.js` insert omits `tenant_id` entirely | anon (`lib/supabase.js`) | **Blocked** — both INSERT policies require non-null/matching tenant_id; a NULL value satisfies neither → insert fails, caught, returns `null` | **CRITICAL** | Fix now (1.3b) — thread the tenant_id `engine.js` already resolved into `db.js` |
| Inbound email webhook | `controllers/email.js#handleInboundEmailParse` → `engine.js` → `db.js` | same as above | same — never set | anon | Blocked, same as above | **CRITICAL** | Same fix, shared code path |
| Generic form webhook | `controllers/leadWebhook.js#handleFormLead` → `engine.js` → `db.js` (leads/interactions) | `smart_leads`, `smart_interactions` | Resolved correctly via `getTenantIdForBrand()` (Block 1.2a) **but never passed into `runEngine`/`db.js`** | anon | Blocked, same root cause | **CRITICAL** | Same fix — `leadWebhook.js`'s own `contacts` writes are fine (see next row); only the engine-routed lead/interaction writes are broken |
| Generic form webhook — contact upsert | `controllers/leadWebhook.js#upsertContact` / `#linkLeadContact` | `contacts`, `smart_leads.contact_id` | `getTenantIdForBrand()`, correctly threaded | anon | Enforced correctly (contacts has no legacy permissive policy) | LOW | Leave as-is — this is the model to copy |
| Engine — dead-letter | `engine.js#recordFailedIngestion` | `failed_ingestions` | Passed in correctly (`resolveTenantId(brandDna)`) | anon | Enforced via temp `anon`-INSERT-only policy (documented, tracked debt) | LOW (tracked separately) | Leave as-is; already tracked in DB_AUDIT_REPORT §8 for a post-Block-1 service-role rewrite |
| Engine — auto-reply decision persist | `engine.js` (~line 284) | `smart_leads` (UPDATE) | Implicit — filtered only by `id`, not `tenant_id` | anon | Enforced by the legacy `tenant_leads_update` (`qual: true`) permissive policy — i.e. not really tenant-checked, but functions | LOW today / MEDIUM long-term | No action needed now; will auto-tighten once the legacy permissive policies are dropped (Block 1.4/1.6) |
| Engine — escalation | `lib/escalationService.js#createAndNotifyEscalation` (called from `engine.js`) | `escalations` (INSERT), `smart_leads` (UPDATE) | Passed in explicitly, **and** the `smart_leads` UPDATE double-guards with `.eq('tenant_id', tenantId).eq('id', leadId)` | anon | Enforced correctly + defense-in-depth | LOW | **Model pattern — reference this for future writes** |
| **Legacy WhatsApp-Web pipeline** (`whatsapp-web.js`/Puppeteer, still `client.initialize()`d and live) | `server.js` `client.on('message_create', ...)` (inline, ~590–850) | `smart_leads`, `smart_interactions`, `lead_activities`, `ai_learning`, `escalations` (via `escalationService`) | Hardcoded `TENANT_ID = process.env.DEFAULT_TENANT_ID \|\| '00000...0001'` | anon | Enforced (value matches the RLS dev-fallback literal) | **HIGH** (architectural, not exploitable today) | Do not fix tenant derivation here (deferred per Block 1.2b) — but see Section 4, this is a second full ingestion pipeline duplicating `engine.js` with independent logic |
| **Legacy IMAP email pipeline** | `server.js` `startEmailListener(async (email) => {...})` (~415–555) | `smart_leads`, `smart_interactions`, `lead_activities`, `ai_learning` | Hardcoded `TENANT_ID` (same pattern) | anon | Enforced, same reason | **HIGH** (architectural) | Same as above |
| Dispatch (system-actor route) | `server.js` `POST /api/responder/dispatch` (`requireInternalKey`) | `smart_interactions` (UPDATE), `ai_learning` (UPDATE), `lead_activities` (INSERT) | `lead_activities` insert hardcodes `DEFAULT_TENANT_ID`; the two UPDATEs filter **only by `id`/`interaction_id`, no tenant_id at all** | anon | Enforced by legacy permissive policies (`qual: true`) — not tenant-checked | **HIGH** (no tenant boundary on the UPDATE calls, invisible today because there's one tenant) | Flag for 1.3's RPC design — good target for `record_dispatch_result` RPC (Section 6) |
| Draft action (system-actor route) | `server.js` `POST /api/draft-action` (`requireInternalKey`) | `ai_learning` (UPDATE) | None — filtered only by `interaction_id` | anon | Enforced by legacy permissive policy only | **HIGH**, same reason | Same RPC candidate as above |
| Auto-reply sweeper | `lib/autoReplySweeper.js#sweepScheduledReplies` | `smart_leads` (SELECT candidates + claim UPDATE), `smart_interactions` (SELECT draft) | **No tenant filter at all** — scans across all tenants by design | anon | SELECT enforced by legacy `qual: true` (i.e., not tenant-scoped — this sweeper can see every tenant's due leads) | MEDIUM (functionally fine single-tenant; needs a per-tenant claim boundary before multi-tenant) | Defer — flag as a Block 1.3 "what must be deferred" item tied to real multi-tenant onboarding |
| Follow-up engine | `lib/followUpEngine.js#runFollowUpEngine` | `smart_interactions` (INSERT), `lead_activities` (INSERT) | Hardcoded `DEFAULT_TENANT_ID`, consistently | anon | Enforced (matches fallback literal) | MEDIUM (same hardcode pattern as legacy pipelines) | No action now — same deferred bucket |
| Calls (system-actor route) | `controllers/calls.js#logCall` (`requireInternalKey`) | `call_logs`, `lead_activities`, `smart_interactions` | Hardcoded `DEFAULT_TENANT_ID` | anon | Enforced | MEDIUM | Reference pattern for the internal-key system-actor shape; fine to leave, good RPC candidate later |
| Invoice ingestion (WhatsApp/email attachment) | `controllers/invoices.js#saveInboundInvoice` (called from both legacy pipelines) | `invoices`, Supabase Storage (`invoices` bucket) | Passed explicitly by caller (hardcoded `TENANT_ID`/`TENANT_ID_WA` at call site) | anon (positional `supabaseClient` param) | Enforced | LOW/MEDIUM | No action now |
| Weekly digest | `lib/weeklyDigest.js`, `lib/digestScheduler.js`, `controllers/digest.js` | **Read-only** (no tenant-scoped writes) | `tenantId` param, iterated from real `tenants` rows (scheduler) or trusted `requireInternalKey` caller (controller) | anon | Reads only — subject to the same legacy-permissive SELECT gap as everything else, not new here | LOW | No action |
| Push notify | `lib/pushNotify.js#sendPushToTenant` | `push_subscriptions` (DELETE of expired rows, by their own `id`) | `tenantId` param, trusted caller | anon | Enforced | LOW | No action |
| Tenant registration | `controllers/tenants.js#registerTenant` (`requireInternalKey`) | `tenants` (INSERT — creates the tenant itself) | N/A — not tenant-scoped, it *creates* the scope | anon | `tenants` table has no RLS write-policy gap of the kind seen elsewhere (report doesn't show a permissive `tenants` INSERT policy; this route is the only writer) | LOW | Out of scope — not a tenant-scoped write |
| **Dead code** | `lib/supabaseLeads.js#insertLead`, `lib/supabaseOutreach.js#insertOutreach` | `smart_leads`, `smart_interactions` | Never set (same bug as `db.js`) | anon | Blocked, same as `db.js` | N/A (unused — zero importers found repo-wide) | Optional hygiene: delete as dead code in a later slice; not urgent |

---

## 3. Current Write-Authority Patterns

**Anon client writes (100% of Lane B):** Every single Lane B write in this codebase — webhooks,
cron jobs, the two legacy inline pipelines, the two internal-key system routes — goes through the
one module-level anon client exported by `lib/supabase.js`. There is **no service-role key
anywhere in this codebase** (confirmed via repo-wide grep for `service_role`/`SERVICE_ROLE` — zero
hits outside documentation). This is deliberate per `lib/supabase.js`'s own comment ("Never
instantiate `createClient()` elsewhere") and is consistent with the `failed_ingestions` migration
note in `DB_AUDIT_REPORT.md` §8 ("no service-role write path available"). This is the actual
constraint driving every design decision in Section 5.

**Service-role writes:** None exist.

**Request-JWT writes (`req.supabase`):** Exist only for Lane A (`requireAuth`-gated user routes,
already migrated in Block 1.1). No Lane B path uses this — correctly, since Lane B has no human
session.

**Module-level client writes:** All of Lane B, as above — there is exactly one module-level
client (`lib/supabase.js`'s `supabase` export), imported directly by `db.js`, `engine.js`,
`server.js`, `controllers/calls.js`, `controllers/leadWebhook.js`, `controllers/tenants.js`,
`controllers/digest.js`, and indirectly passed as a parameter into `lib/*.js` helper functions
(`weeklyDigest.js`, `autoReplySweeper.js`, `followUpEngine.js`, `escalationService.js`,
`pushNotify.js`). No file instantiates its own `createClient()` — the "single canonical client"
rule from `lib/supabase.js`'s docblock is actually honored everywhere in app code (only test files
under `tests/*.migration.test.js` create their own throwaway anon clients for gated integration
tests, which is expected and fine).

**Raw SQL / RPC calls from Lane B:** None. The two existing SECURITY DEFINER RPCs
(`get_tenant_members`, `get_user_id_by_email`, Migration 11) and the SECURITY INVOKER
`adjust_product_stock` RPC (Block 0.2) are only called from Lane A (`requireAuth`-gated)
controllers (`controllers/team.js`, `controllers/products.js`, `controllers/productImport.js`).
Lane B has zero RPC usage today — every Lane B write is a direct PostgREST
`.insert()`/`.update()`/`.delete()` call against the anon client.

**Test-only/dev-only fallbacks:** `lib/authMiddleware.js`'s `DEV_BYPASS_AUTH` branch sets
`req.tenantId = DEFAULT_TENANT_ID` and `req.supabase = supabase` (the anon client) — this is Lane
A's dev fallback, not Lane B, and already documented/accepted from Block 1.1.

---

## 4. Unsafe or Ambiguous Findings

### Finding A — `db.js#saveLeadAndLogToDatabase` never writes `tenant_id` (and neither do its two dead-code siblings)
- **File/function:** `db.js:34-53` (smart_leads insert), `db.js:56-62` (smart_interactions insert); same bug in `lib/supabaseLeads.js:12-27` and `lib/supabaseOutreach.js:12-22` (both unused).
- **Why unsafe/ambiguous:** `tenant_id` is simply absent from the insert payload. The column has no DB-level default (confirmed via `information_schema.columns`, live). Both current INSERT policies on `smart_leads` (`smart_leads_tenant_insert`: `tenant_id = auth_tenant_id() OR tenant_id = <fallback>`; `tenant_leads_insert`: `tenant_id IS NOT NULL`) evaluate false for a NULL value, so **RLS rejects the insert outright**. `db.js` catches the error and returns `null`; `engine.js` treats a null `dbResult` as "DB sync failed (non-fatal)" and continues, so the caller-facing response still looks like success even though no lead row was created.
- **Exploitable now or future blocker:** Not exploitable (it fails closed, not open) — but it is a **live functional bug**: any lead arriving through the Meta Cloud API WhatsApp webhook, the email webhook, or the generic form webhook, for a **brand-new** phone number, silently fails to create a `smart_leads`/`smart_interactions` row. (Existing phone numbers short-circuit into the "upsert by phone" branch and only get a broken `smart_interactions` insert, same root cause.) This has evidently been masked because the ingestion volume this system has actually processed in production so far went through the *other*, legacy pipeline (Finding B) instead.
- **Recommended block/slice:** Fix in 1.3b (no-migration, code-only) — thread the already-resolved `tenantId` from `engine.js` into `saveLeadAndLogToDatabase(profile, draftText, channel, tenantId)`.

### Finding B — Two independent, duplicate lead-ingestion pipelines exist, and the "legacy" one is what's actually live
- **File/function:** `server.js` — the `whatsapp-web.js` `client.on('message_create', ...)` handler (~584–850) and the `startEmailListener(async (email) => {...})` callback (~415–555).
- **Why unsafe/ambiguous:** These do not call `engine.js` at all. They reimplement triage (`AI_Triage.js#performAITriage` instead of `parser.js#parseIncomingLead`), drafting (`responder.js#generateSalesDraft` instead of `writer.js#generateTailoredOutreach`), and DB sync independently, with their own inline `.insert()`/`.update()` calls, their own escalation call, their own `ai_learning` bookkeeping, and **no `failed_ingestions` dead-letter write on failure** (Block 0's safety net doesn't cover this pipeline at all). Tenant identity here is a hardcoded env-var read at call time, not derived from `brand_dna` the way `engine.js` does it.
- **Exploitable now or future blocker:** Not an auth/security exploit — it's an **architectural duplication risk**. Two pipelines mean two places to keep in sync (auto-reply rules, escalation rules, catalogue context, language handling already drifted slightly — e.g. the legacy pipeline fetches `tenants.auto_reply` per-message while `engine.js` does the same but with a different query shape). It also means any future Lane B write-authority fix (this block) has to be applied in **two places**, not one, or the fix will be incomplete. `client.initialize()` at the bottom of `server.js` confirms this pipeline is live, not dead code.
- **Recommended block/slice:** Out of scope to *unify* these pipelines in 1.3 (that's a bigger refactor, arguably its own future block) — but any Lane B write-authority pattern this block proposes must explicitly account for **both** pipelines, or it will only fix half the surface area. Flagged for product/CTO awareness, not a migration item.

### Finding C — System-actor routes (`/api/responder/dispatch`, `/api/draft-action`) have zero tenant boundary on their UPDATE calls
- **File/function:** `server.js:203-326` (`POST /api/responder/dispatch`), `server.js:332-385` (`POST /api/draft-action`).
- **Why unsafe/ambiguous:** Both routes are gated by `requireInternalKey` (a shared secret, not a JWT — appropriate for a Lane B system route) and both accept an `interaction_id` from the request body, then `.update()` `smart_interactions`/`ai_learning` filtered **only by that id**, never cross-checked against a tenant. Today this is invisible because (a) there's one tenant and (b) the underlying tables' UPDATE policies are the legacy `qual: true` permissive ones anyway, so RLS wouldn't stop a cross-tenant update even if attempted.
- **Exploitable now or future blocker:** **Future blocker**, not exploitable today (no second tenant exists to cross into, and the caller must already hold `INTERNAL_API_KEY`, a real secret — trusted operator surface, not internet-facing). But the moment a second tenant exists, a caller holding the internal key (frontend proxy, by design) could dispatch/mark-sent an `interaction_id` belonging to a different tenant with no error, purely because nothing checks.
- **Recommended block/slice:** Good candidate for the `record_dispatch_result` RPC in Section 6, scheduled alongside real multi-tenant onboarding — not urgent pre-launch since it requires a second tenant to matter, but should be designed now while this audit has full context.

### Finding D — `lib/autoReplySweeper.js` scans and claims across all tenants with no tenant filter
- **File/function:** `lib/autoReplySweeper.js:100-153` (`sweepScheduledReplies`).
- **Why unsafe/ambiguous:** The initial candidate `SELECT` and the claim `UPDATE` are both filtered only by `auto_reply_status`/`scheduled_dispatch_at`/`claimed_at` — never by `tenant_id`. This is fine functionally (the sweeper is a single global background job by design, and each row already carries its own destination channel/phone/email), but it means there is no per-tenant rate limiting, no per-tenant kill-switch, and no way to reason about "tenant A's sweep" in isolation.
- **Exploitable now or future blocker:** Future blocker only — not a security issue (a lead's own row data determines where its message goes; there's no cross-tenant data leakage possible here), more an operability gap for when a tenant needs to be paused independently.
- **Recommended block/slice:** Defer to whenever real multi-tenant onboarding lands (same trigger condition as Block 1.2's reopening criteria) — no action needed for Block 1.3.

### Finding E — Legacy permissive RLS policies still coexist on 9 tables (pre-existing, not new)
- **File/function:** N/A — live Postgres policy state (`tenant_leads_select`/`_update`/`_delete`, `tenant_interactions_*`, `tenant_activities_*`, and siblings on `closed_deals`, `invoices`, `quotes`, `email_threads`, `call_logs`, `segments`, `whatsapp_sessions`).
- **Why unsafe/ambiguous:** Already fully documented as the Block 1 SHOWSTOPPER in `DB_AUDIT_REPORT.md` §7/§10. Repeated here only because it directly interacts with every Lane B finding above: it's *why* Findings A/C currently fail-safe or fail-open the way they do (e.g., Finding A fails closed because the *newer* `smart_leads_tenant_insert` policy still requires a non-null tenant match even though the legacy `tenant_leads_insert` would accept any non-null value; Finding C's updates succeed today only because the legacy `qual: true` UPDATE policies exist alongside the tenant-scoped ones).
- **Exploitable now or future blocker:** Already tracked as launch-blocking. Not new.
- **Recommended block/slice:** Explicitly **not** Block 1.3's job — already slated for Block 1.4/1.6 per existing tracking. Block 1.3 should not touch these policies; it should only be aware that dropping them later will change Lane B's effective behavior (e.g., Finding C's routes will start actually needing the tenant check they currently lack, once the legacy `qual: true` fallback disappears).

---

## 5. Proposed Block 1.3 Target Pattern

**Core constraint driving the design:** Lane B has no JWT and no service-role key, only the anon
key. Under the *current* RLS policies, that anon key can only ever successfully write a
tenant-scoped row in one of two ways: (a) `tenant_id` exactly equals the hardcoded dev-fallback
literal baked into every tenant-scoped policy (`00000000-0000-0000-0000-000000000001`), or (b) on
the subset of tables that still carry a legacy permissive policy, any non-null `tenant_id` at all
(no identity check). Neither of these generalizes to a real second tenant. This is *why* a
system-actor boundary is needed — not because today's single-tenant behavior is unsafe, but
because there is currently no code path by which the anon key could ever legitimately write a row
for a second tenant, short of adding that tenant's UUID as another `OR` branch in every policy
(which is what Block 1.2b already correctly declined to do).

**When to use an RPC:** Only for the write paths that need to keep working once a **second real
tenant** exists — i.e., paths whose correctness today accidentally depends on the fallback-UUID
coincidence (Findings A, B's tenant-hardcoding, C, and the hardcoded-`DEFAULT_TENANT_ID` cluster
in `followUpEngine.js`/`calls.js`). A SECURITY DEFINER RPC lets these paths keep using the anon
key for transport while the *function body* — running with elevated privilege — validates the
caller-supplied `tenant_id` against something trustworthy (e.g., re-deriving it server-side from
`brand_dna`/a future channel-mapping table, exactly as `engine.js#getTenantIdForBrand` already
does in-process) before writing. This mirrors the precedent already set by
`get_tenant_members`/`get_user_id_by_email` (Migration 11) and keeps the "one canonical anon
client, no service-role key" constraint intact — the RPC *is* the elevation mechanism, not a new
key.

**When to keep app-layer writes:** Anything that (a) doesn't need multi-tenant correctness beyond
what Block 1.2's existing `getTenantIdForBrand()`-style derivation already provides, or (b) is
purely additive bookkeeping guarded by an existing trusted write (e.g., `failed_ingestions`,
`lead_activities` rows written immediately after a trusted insert in the same request). Finding A
is explicitly **not** an RPC candidate — it's a plumbing bug, fixable by passing an
already-trusted value one level deeper. Don't reach for a migration where a function argument
would do.

**Should RPCs be SECURITY DEFINER?** Yes, for the ones in Section 6 — unlike
`adjust_product_stock` (Block 0.2, SECURITY INVOKER, because the anon role already had adequate
table+RLS grants for that specific flow), Lane B's problem is precisely that the anon role does
**not** and structurally **cannot** have adequate per-tenant grants without a real auth session.
SECURITY DEFINER is the correct tool here: the function runs as its owner (bypassing the caller's
RLS) but re-validates tenant identity itself, inside the function body, the same way
`get_tenant_members` does today.

**How should `tenant_id` be passed/validated?** Never trust a caller-supplied `tenant_id` as the
final word (this is the same principle Block 1.2a already established for `/webhook/lead`). Each
RPC should re-derive or re-validate tenant identity from a source the caller cannot forge — e.g.
re-look-up `brand_dna.tenant_id` for the channel/brand the message actually arrived on, the same
lookup `engine.js` already performs. The RPC's `p_tenant_id` argument (if present at all) should
be treated as a hint/assertion that the function cross-checks, not a bare pass-through — mirroring
`adjust_product_stock`'s explicit `WHERE tenant_id = p_tenant_id` rejection-on-mismatch pattern.

**How should `failed_ingestions` behave?** Unchanged by this block. It already has its own tracked
follow-up (`DB_AUDIT_REPORT.md` §8: replace the temp anon-INSERT policy with a service-role/RPC
path once Block 1 lands). That rewrite is a natural companion to whichever RPC slice lands first
in 1.3's future work, but is not itself blocking — leave it as-is for now, per the task's
explicit instruction not to touch it beyond documenting.

**How does this prepare for later RLS tightening (Block 1.4/1.6)?** Once the legacy `qual: true`
permissive policies are dropped, every Lane B write that isn't already going through a
tenant-validating RPC (or the fixed `db.js` path from Finding A) will start failing closed, the
same way Finding A does today. Doing the Finding-A fix now, and scoping (but not yet building)
the RPCs in Section 6, means Block 1.4/1.6 can drop the legacy policies without silently breaking
Lane B — the audit in this document is what makes that later cleanup safe to sequence.

---

## 6. Candidate RPC Boundaries

These are **candidates to design later**, not to build in this block. Each is scoped to the exact
finding above that motivates it.

1. **`create_inbound_lead`** (motivated by Finding A, but see note below)
   - **Purpose:** Atomically upsert-by-phone/email and insert a `smart_leads` row + its initial
     `smart_interactions` draft row, with tenant identity re-derived server-side.
   - **Inputs:** `p_brand_id` (or channel identifier), lead fields, draft text.
   - **Tables touched:** `smart_leads`, `smart_interactions`.
   - **Why RPC is/isn't justified:** **Not justified for the immediate fix** — Finding A's actual
     bug is that an already-correctly-derived `tenantId` (computed in `engine.js`, trusted) just
     isn't passed one function call deeper. That's a one-line plumbing fix, not a privilege
     problem. This RPC *becomes* justified only once a second tenant exists and the anon role can
     no longer structurally satisfy the INSERT policies for that tenant (see Section 5) — at that
     point, wrap the same logic in a SECURITY DEFINER function so the anon key can still transport
     the write. Until then, the no-migration fix is enough.
   - **Risks:** Re-deriving tenant identity inside Postgres means duplicating (or calling into)
     the same `brand_dna` lookup `engine.js` does in JS — needs to stay in sync with Block 1.2's
     derivation logic, not reinvent it.
   - **Tests needed (when built):** tenant A cannot create a lead under tenant B's id even if
     asserted; concurrent inserts for the same phone number don't duplicate; RPC rejects a
     brand_id with no matching `brand_dna` row the same way `engine.js` does today (throws,
     doesn't silently default).

2. **`record_dispatch_result`** (motivated by Finding C)
   - **Purpose:** Replace the inline `.update()` calls in `/api/responder/dispatch` and
     `/api/draft-action` with one function that validates the `interaction_id` actually belongs
     to the tenant the internal-key caller is allowed to touch, before updating
     `smart_interactions`/`ai_learning`/inserting `lead_activities`.
   - **Inputs:** `p_interaction_id`, `p_tenant_id` (asserted, re-validated), delivery outcome
     fields.
   - **Tables touched:** `smart_interactions`, `ai_learning`, `lead_activities`.
   - **Why RPC is justified:** These routes are already gated by a shared secret
     (`requireInternalKey`), not per-tenant identity — an RPC is the natural place to add the
     tenant cross-check that's currently entirely absent, without changing the route's auth model.
   - **Risks:** `requireInternalKey` is a single shared secret for *all* tenants' system calls —
     the RPC can enforce "this interaction belongs to this tenant" but can't itself distinguish
     which tenant a given internal-key caller *should* be limited to (the frontend proxy holds one
     key for the whole app). Full fix may need the frontend's dispatch proxy to also carry/assert
     a tenant context, which is outside this block.
   - **Tests needed (when built):** update rejects an `interaction_id` whose tenant doesn't match
     `p_tenant_id`; existing dispatch happy path (single tenant) unaffected.

3. **`claim_scheduled_reply`** (motivated by Finding D — lower priority)
   - **Purpose:** Formalize the sweeper's existing conditional-UPDATE claim (Block 0.3) as an RPC
     that also accepts a tenant filter, so a future per-tenant pause/kill-switch is possible.
   - **Tables touched:** `smart_leads` (the `claimed_at` column already exists).
   - **Why RPC is/isn't justified:** **Not justified now.** The existing plain conditional UPDATE
     already gives correct single-row exclusivity (verified live, Block 0.3, 30-way concurrency
     test passed). An RPC only adds value once there's a real per-tenant operability need
     (pause tenant X's sweeper). Revisit at multi-tenant onboarding, not before.
   - **Risks:** N/A — deferred.
   - **Tests needed:** N/A — deferred.

4. **`upsert_contact_for_channel`** — **not needed**. `leadWebhook.js#upsertContact` already
   works correctly (Finding row in Section 2, "contacts upsert") because `contacts` never had the
   legacy permissive-policy problem. No RPC required; this is the pattern the others should grow
   toward, not a gap.

5. **`record_failed_ingestion`** — **not needed now**, already tracked separately in
   `DB_AUDIT_REPORT.md` §8 as a post-Block-1 service-role rewrite. Don't duplicate that tracking
   here; just cross-reference it (done, above).

---

## 7. What Must Be Deferred

- **Broad RLS policy changes** (dropping the 9 tables' legacy permissive policies) — tracked
  separately as the Block 1 SHOWSTOPPER (`DB_AUDIT_REPORT.md` §7/§10); belongs in Block 1.4/1.6,
  not here.
- **SECURITY DEFINER / function-level leak cleanup** for the existing `get_tenant_members` /
  `get_user_id_by_email` functions (currently gated only by `INTERNAL_API_KEY`, per Migration 11's
  own noted caveat) — Block 1.7, as instructed.
- **`DEFAULT_TENANT_ID` removal** — Block 1.8. Every hardcoded reference catalogued in Section 2/3
  stays exactly as-is; this audit only documents where they are, it does not touch them.
- **Consolidated cross-tenant integration tests** — Block 1.9, once there are ≥2 real tenants to
  test cross-contamination against. The tests proposed in Section 9 below are the Block 1.3-scoped
  subset (mostly single-tenant-safe regression checks), not the full cross-tenant suite.
- **Decision Brain** — untouched, not referenced anywhere in this audit.
- **Unifying the two duplicate ingestion pipelines** (Finding B) — flagged for CTO/product
  awareness, not scoped into any specific numbered future block by this audit; it's a bigger
  refactor decision than tenant-write-authority.
- **Reopening Block 1.2** — not done. Tenant *derivation* logic (`getTenantIdForBrand`,
  `resolveTenantId`) is treated as correct and untouched throughout this audit; every finding
  above is about writes not *using* an already-correct derivation, not about the derivation itself
  being wrong.

---

## 8. Implementation Slicing Proposal

**1.3a — this document.** Audit/docs only. Already complete as of this planning session. No code,
no migration.

**1.3b — no-migration cleanup (Finding A fix).**
- **Exact scope:** Thread the already-resolved `tenantId` into `db.js#saveLeadAndLogToDatabase`
  (add a `tenantId` parameter, include it in both the `smart_leads` and `smart_interactions`
  insert payloads) and update its one caller (`engine.js`, which already has `brandDna.tenant_id`
  in scope at the call site). Delete or fix the two dead-code siblings
  (`lib/supabaseLeads.js`, `lib/supabaseOutreach.js`) — recommend deleting, since grep confirms
  zero callers repo-wide; fixing unused code adds no value.
- **Likely files touched:** `db.js`, `engine.js` (one call-site change), optionally
  `lib/supabaseLeads.js`/`lib/supabaseOutreach.js` (delete).
- **Tests required:** Update `tests/writer.test.js`/any `db.js`-adjacent unit tests to assert
  `tenant_id` is present in the insert payload (mock-based, no live DB needed); existing gated
  integration tests (`RUN_DB_INTEGRATION_TESTS=true`) should be extended or a new
  `tests/dbLead.migration.test.js` added to confirm a **new-phone-number lead insert actually
  succeeds against live RLS** post-fix (this is the first test in this codebase that would have
  caught Finding A — worth having).
- **Rollback strategy:** Trivial — single-file code revert, no schema/data touched.
- **Risk level:** LOW. This only makes previously-silently-failing inserts start succeeding; it
  cannot make a previously-succeeding write start failing, since the value being added
  (`tenantId`) was already being computed and already RLS-permitted for the one tenant that
  exists.
- **Migration approval required?** No — no schema/RLS change.

**1.3c — RPC design spike (not build) for `create_inbound_lead` / `record_dispatch_result`.**
- **Exact scope:** Write the actual SQL function bodies + a design doc for Command Room review,
  informed by Section 6 above. Do not apply. This is prep work so that when a second tenant is
  imminent, the RPC migration is a fast, pre-reviewed slice rather than a from-scratch design
  exercise under time pressure.
- **Likely files touched:** New `supabase/migrations/*.sql` (drafted, not applied), a short design
  doc.
- **Tests required:** None yet (nothing is applied).
- **Rollback strategy:** N/A — no live change.
- **Risk level:** None (docs/draft only).
- **Migration approval required?** Not for the drafting; yes before any `apply_migration` call.

**1.3d — apply the RPC migration(s), only once a second tenant/channel is actually being
onboarded** (same trigger condition already established for reopening Block 1.2).
- **Exact scope:** Apply `create_inbound_lead` and/or `record_dispatch_result`, cut over the
  relevant call sites, remove the now-redundant inline `.insert()`/`.update()` logic.
- **Likely files touched:** `db.js` or its replacement, `server.js` (dispatch/draft-action
  routes), `supabase/migrations/`.
- **Tests required:** Full cross-tenant isolation suite (Section 9's deferred items), gated
  integration tests against live Postgres, concurrency tests matching the Block 0.2/0.3 pattern.
- **Rollback strategy:** `DROP FUNCTION` is non-destructive (no data migration); call-site revert
  alongside it.
- **Risk level:** MEDIUM (new SECURITY DEFINER surface — needs the same database-lead +
  security-lead dual review Block 0.2/0.3 got).
- **Migration approval required?** Yes — Command Room sign-off required, same bar as Block 0's
  RPCs.

---

## 9. Test Plan

Scoped to what's testable **today**, single-tenant (the full cross-tenant suite is explicitly
Block 1.9, per Section 7):

- **Tenant A cannot write tenant B data through a Lane B helper** — not yet testable (only one
  tenant exists); becomes real once 1.3d's RPCs exist and a second tenant is created. Note this as
  a gap, not a pass.
- **System path cannot omit `tenant_id`** — directly testable now: a new
  `tests/dbLead.migration.test.js` (gated, `RUN_DB_INTEGRATION_TESTS=true`) asserting that
  `saveLeadAndLogToDatabase` without a `tenantId` argument fails fast/explicitly post-1.3b (rather
  than silently swallowing the RLS error), and that passing the correct one succeeds against live
  Postgres.
- **System path cannot use spoofed `tenant_id` where derivation should be trusted** — already
  covered by Block 1.2a's own tests for `/webhook/lead`; Block 1.3 doesn't reopen this, only
  confirms `db.js`'s fix consumes the same already-trusted value rather than accepting a new
  input.
- **`failed_ingestions` write path remains best-effort and safe** — unchanged by this block;
  existing `tests/failedIngestions.migration.test.js` (8/8 passing per DB_AUDIT_REPORT §8) already
  covers this and needs no new assertions here.
- **Service-role/RPC path only touches intended tables** — N/A for 1.3b (no RPC yet); becomes a
  1.3d test once `create_inbound_lead`/`record_dispatch_result` exist, following the
  `adjust_product_stock` test pattern (`tests/stockMovement.migration.test.js`) as the template.
- **RLS remains authoritative where expected** — regression-check only: re-run the existing gated
  suites (`tests/failedIngestions.migration.test.js`,
  `tests/stockMovement.migration.test.js`, `tests/autoReplySweeper.migration.test.js`) after 1.3b
  lands to confirm nothing in the `db.js` change regresses them (none of them touch `db.js`
  directly, so this should be a no-op confirmation, not a new test).
- **Existing webhook happy paths still pass** — full normal suite (`npm test`) after 1.3b, plus
  manual verification against a **new** (never-seen) phone number/email through
  `/webhook/whatsapp`, `/webhook/email`, and `/webhook/lead` in a dev environment, confirming a
  `smart_leads` row is actually created (this exact case is what's silently broken today).

---

## 10. Open Questions for Command Room

1. **Is the legacy `whatsapp-web.js`/IMAP pipeline in `server.js` (Finding B) still the intended
   production path for Lala, or is the Meta Cloud API + `engine.js` pipeline meant to fully
   replace it?** This audit doesn't change either pipeline, but Block 1.3's RPC work (1.3c/1.3d)
   should target whichever pipeline is actually meant to be load-bearing going forward — building
   `create_inbound_lead` against `engine.js`'s call shape only helps if that's the pipeline that
   stays. This is a product/architecture call, not something inferable from the code alone.
2. **Should 1.3b (the `db.js` tenant_id fix) go out as its own small commit ahead of any other
   Block 1.3 work, given it's a live functional bug independent of the RLS/RPC story?** Flagging
   because it's technically a bug fix, not a security-hardening change, and the user's task frame
   was security/write-authority — worth explicit confirmation it's in scope for *this* block
   rather than a separate fast-tracked fix.

No other blocking questions — everything else in this audit is either already decided by prior
blocks' precedent (system-actor pattern via SECURITY DEFINER, mirroring Migration 11) or
explicitly deferred per the task's own boundaries.

---

## 11. Recommendation

**Do a docs-only close of 1.3a (this document) first — already done.** Then:

- **Proceed with 1.3b as a small, low-risk, no-migration implementation slice** (thread
  `tenant_id` into `db.js`, delete the two dead-code files). This fixes a live bug, needs no new
  approval beyond normal code review, and cannot make anything currently working start failing.
- **Pause 1.3c/1.3d for RPC/migration approval**, and don't build them yet — they're only
  load-bearing once a second tenant or a real multi-tenant dispatch scenario is imminent, which
  mirrors the exact reopening condition already agreed for Block 1.2. Draft the SQL now if useful
  for planning velocity later, but don't apply.
- **Do not revise architecture before coding** — the two-pipeline duplication (Finding B) is real
  but is a separate, larger decision (product/CTO scope) than "write authority," and forcing a
  unification into this block would blow its scope far past what was asked.
