# Block 1.2b — Lane B Tenant Mapping Architecture (Command Room Decision Doc)

_Planning only. No migration, RLS change, or code change has been made. Nothing in this
document is applied until Command Room (Shyama) explicitly approves a specific next step._

**Parent:** Block 1 — Tenant Auth/RLS Cleanup
**Preceding work:** Block 1.1 (Lane A JWT migration, complete), Block 1.2a (`/webhook/lead`
fixed migration-free, commit `519f08e`)

**Board input:** database-lead, security-lead, and cto-ai reviewed this design in parallel.
Their reasoning is folded into the relevant numbered sections below (schema → §5, trust model →
§4/§6, sequencing → §7/§10) rather than kept as a separate summary, so each point sits next to
the design decision it drove.

---

## 1. Existing data/config inventory

Systematic pass over everything in the repo today that could plausibly support tenant
derivation for Lane B, what it actually does, and why it's insufficient on its own.

| Item | Where it exists | What it stores | Trusted for tenant derivation today? | Can it support multi-tenant routing? | Limitations |
|---|---|---|---|---|---|
| `tenants.settings` (JSONB) | `tenants` table, written at `controllers/tenants.js:104-109` | `whatsapp_number`, `country`, `business_type`, `owner_name` | No | Not as-is | Write-only — captured at onboarding, never read back by any inbound handler. No index, no uniqueness enforcement, no way to do a fast exact-match lookup at webhook-hit time without a functional index most ORMs/Supabase clients won't express cleanly. |
| `whatsapp_number` field | Inside `tenants.settings` (see above) | A single phone number string per tenant, self-reported at signup | No | No | Same JSONB limitations. Also single-valued — no support for a tenant with more than one WhatsApp number. |
| `whatsapp_sessions` table | Referenced in `controllers/tenants.js:173-188`; schema per `DB_AUDIT_REPORT.md:31,244-249` | wwebjs pairing/session status per tenant (`status`, e.g. `'ready'`) | No | No | Tracks *pairing state*, not routing identity — has no phone-number column to look up by. Also carries a known, separately-tracked bug: `tenant_id` is **VARCHAR, not UUID** (`DB_AUDIT_REPORT.md:244-249`), inconsistent with every other tenant-scoped table. Independent of this design (§5 confirms no dependency), but not safe to build on top of as-is. |
| `brand_dna` table | `engine.js:91-101`, queried `.eq('id', brandId).single()` | `brand_name`, `brand_voice_guidelines`, `tenant_id` (UUID), keyed by an `int4 serial` PK | Yes — this is what Block 1.2a's fix relies on | Only for `/webhook/lead` today, and only because every caller hardcodes `brandId=1` | Not itself an identity-routing table — it's a content/config table keyed by an internal serial ID with no relationship to any inbound caller-supplied signal (phone number, mailbox, source token). Reusing it for WhatsApp/email would require guessing which `brandId` an inbound message belongs to, which is the exact problem this document is solving. |
| Email listener / IMAP config | `lib/emailListener.js:13-17,56-62`; wired at `server.js:411-416` | Env vars: `EMAIL_IMAP_HOST`, `EMAIL_IMAP_PORT`, `EMAIL_IMAP_USER`, `EMAIL_IMAP_PASS`, `EMAIL_IMAP_ENABLED` | No | No | One IMAP mailbox, one set of credentials, globally configured via env vars — there is no per-tenant mailbox concept anywhere in this config. Structurally single-mailbox by design today. |
| `WEBHOOK_SECRET` | `controllers/leadWebhook.js:123`, checked at `lib/formLeadCore.js:39-44` | One shared secret string, optional | Proves "this is our webhook config," not "which tenant" | No | Single global secret — cannot distinguish between form sources or tenants even if there were multiple. Not a routing mechanism, a gate. |
| Meta WhatsApp verify token | `controllers/whatsapp.js:10` — `META_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_VERIFY_TOKEN` | One shared token, used only for the GET handshake (`hub.verify_token`) | Proves "this is Meta talking to our one configured webhook," not "which tenant" | No | Same category as `WEBHOOK_SECRET` — an existence gate, not an identity map. Also only relevant to the one-time subscribe handshake, irrelevant to per-message routing. |
| Form/source identifiers | `lib/webhookLeadSchema.js` (Zod schema for `/webhook/lead`) | `data.source` — a free-text label (e.g. `'tally'`, `'typeform'`) supplied in the form payload itself | No — and must never be, it's caller-supplied | No | This is a **display label**, not an authenticated identity. `controllers/leadWebhook.js:91` uses it only to annotate `[SOURCE CHANNEL: FORM / {source}]` in the compiled payload text. There is no per-source secret or token today — every form source shares the one global `WEBHOOK_SECRET`. |
| Connected account / integration config | `frontend/src/app/app/integrations/page.tsx` | UI shell for email IMAP/SMTP + WhatsApp QR connection | No | No | Per `docs/OPEN_TASKS.md §3.6` ("Integrations page completion... wire the email IMAP/SMTP form to persist"), this page is not yet wired to persist configuration server-side — it is a stopgap UI, not a data source today. |
| `DEFAULT_TENANT_ID` / hardcoded `brandId=1` | `engine.js:19,22`; `controllers/whatsapp.js:81`; `controllers/email.js:32`; `controllers/ingest.js:34`; `server.js:311,416,633,671`; `lib/authMiddleware.js:24,32` (dev-bypass only) | One hardcoded UUID (`00000000-0000-0000-0000-000000000001`), env-overridable | This **is** the current (unsafe) mechanism for all of Lane B except `/webhook/lead` post-1.2a | No — this is precisely the absence of routing this document is addressing | Pervasive across the codebase (9+ call sites). Any future mapping design must ensure this value is never reachable from a production inbound path except as an explicit, gated local/dev fallback (see §6, §9). |

**Conclusion:** nothing in the current schema or config supports safe multi-tenant routing for
WhatsApp or email. `brand_dna` (via `getTenantIdForBrand`, Block 1.2a) is the one piece of
existing infrastructure doing real, trustworthy tenant derivation today, and it only works
because there is exactly one reachable row. A new mechanism is required for any channel where a
caller-supplied signal (phone number, mailbox address) needs to resolve to one of *several*
possible tenants.

---

## 2. Channel-by-channel trusted identifiers

| Channel | Safest inbound identifier | Must NOT be trusted | Does current code support it? | Gap to production-safe multi-tenant routing |
|---|---|---|---|---|
| **Meta WhatsApp webhook** | Meta's `phone_number_id` (the Cloud API's own identifier for *which of our registered numbers* received the message — present in the webhook payload's `metadata` object, distinct from the sender's `from` number) | The sender's `from` phone number (that's the *customer*, not us — it identifies who's messaging, not which tenant's number they messaged) | No — `controllers/whatsapp.js` doesn't read `phone_number_id` at all today, hardcodes `brandId=1` | Needs a `phone_number_id → tenant_id` mapping row per tenant-owned WhatsApp Business number, populated at tenant WhatsApp connection time (not self-reported free text). |
| **whatsapp-web.js listener** | The wwebjs client's *own paired session identity* (i.e., which local session/device this Node process's `client` instance is paired to) — effectively 1:1 with a single `whatsapp_sessions` row per process today, not a per-message signal | `msg.from` (again, the customer, not us) | No — `server.js`'s `client.on('message_create', ...)` hardcodes `TENANT_ID = DEFAULT_TENANT_ID` | Architecturally different problem: this is a single Puppeteer-driven process per deployment today, not a webhook receiving traffic for many tenants at once. Multi-tenant support here would need either one process per tenant or a session→tenant lookup keyed by which paired device sent the event — out of scope for this design, and explicitly protected by the standing "augment-only" guardrail regardless (see §7). |
| **Email webhook / inbound parse** | The `to` / recipient address the inbound-email-parse provider (Mailgun/Postmark/SendGrid) reports the message was delivered to — i.e., which of *our* configured inbound addresses received it | The `from` sender address (again, the customer) | No — `controllers/email.js` reads `req.body.from`/`req.body.sender` only for display text, never a `to`/recipient field, and never for tenant derivation | Needs a `recipient_address → tenant_id` mapping, populated when a tenant sets up a dedicated inbound address (e.g. `leads+{tenant-slug}@ourdomain.com` or a tenant-provided forwarding address they verify). |
| **IMAP listener** | Currently N/A — one global mailbox, one set of credentials, serves at most one tenant by construction | Any `from`/`to` header parsed out of the email — headers are attacker-writable | No — `lib/emailListener.js` has no per-tenant concept at all | This is the same underlying gap as the email webhook, but the *mechanism* (poll one shared IMAP inbox vs. receive provider webhooks per configured address) doesn't naturally support multiple tenants without either (a) one IMAP account per tenant (config/ops burden) or (b) parsing a per-tenant routing signal out of the `to`/envelope-recipient the mailbox provider preserves for aliases — needs a provider-specific decision before this can be designed further. |
| **Forms / `/webhook/lead` future multi-tenant source routing** | A per-source bearer token (distinct from today's one global `WEBHOOK_SECRET`) — i.e., each configured form source (a specific Tally/Typeform account) gets issued its own token, looked up server-side to resolve `tenant_id` | `data.source` (free-text label, caller-supplied — see §1), any body/query `tenant_id` field, `x-tenant-id` header (Block 1.2a already closed this specific vector) | No — today `/webhook/lead` is genuinely single-tenant via the `brand_dna` derivation from 1.2a; there is no per-source-token concept | This is a **different trust primitive** from WhatsApp/email (a bearer credential, not a public-ish identity value) — see §4 and §9 for why this likely needs separate handling rather than folding into the same generic table. |

---

## 3. Mapping design options

### Option A — Reuse existing `tenants.settings` JSONB

- **What it stores:** the phone number / mailbox address directly inside each tenant's existing `settings` blob (extending the already-present but currently write-only `whatsapp_number` field, adding an equivalent for email).
- **How each channel would query it:** `SELECT id FROM tenants WHERE settings->>'whatsapp_number' = $1` (and equivalent for email) — a full-table scan or a functional index on the JSONB path, run on every inbound webhook hit.
- **Pros:** zero new tables, no new migration file, reuses a column that already exists.
- **Cons:** no native uniqueness constraint on a JSONB path (Postgres *can* do a partial expression-index unique constraint on a JSONB key, but it's awkward, easy to get wrong, and not how this repo's schema conventions work elsewhere); no clean multi-value support (a tenant with two WhatsApp numbers needs an array inside the JSONB, further complicating the uniqueness/lookup story); no dedicated `disabled`/soft-delete state distinct from the tenant's own lifecycle; every future channel (forms, future integrations) adds another ad-hoc JSONB key with its own bespoke query, not a consistent lookup contract.
- **Security risks:** highest of the three options — a hand-rolled JSONB uniqueness check is easy to get subtly wrong (e.g. case sensitivity, whitespace, an update path that doesn't re-check uniqueness), and there's no natural place to record `verified_at`/audit metadata without further overloading the same blob.
- **Migration required:** technically no new table, but *some* migration is still likely needed for a functional unique index on the JSONB path to make the lookup fast and safe — so this option doesn't actually avoid a migration, it just makes a worse one.
- **Testability:** harder — asserting "this JSONB shape is queried correctly" is less direct than asserting behavior against a typed table with real constraints.
- **Multiple sources per tenant:** poor — requires nested arrays inside JSONB, no per-value metadata (verified_at, disabled) without further nesting.
- **Rotation/revocation:** no clean model — "revoking" a number means mutating a JSONB blob with no history.
- **Ownership verification implications:** no natural place to record verification state per identifier (only per-tenant, if at all).
- **Verdict:** rejected. Insufficient on every dimension that matters for a routing table specifically.

### Option B — One generic `channel_identities` (or `tenant_channel_mappings`) table

- **What it stores:** one row per (channel, identity_value) pair, pointing at a `tenant_id`. See full schema in §5.
- **How each channel would query it:** `SELECT tenant_id FROM channel_identities WHERE channel = 'whatsapp' AND identity_value = $1 AND deleted_at IS NULL` — one indexed exact-match lookup, same shape for every channel.
- **Pros:** one migration, one RLS policy set, one index, one query pattern reused by every channel (including a hypothetical future channel — Instagram, SMS — without new schema); real uniqueness enforcement via a partial unique index; clean soft-delete/disable via `deleted_at`; a natural place for `verified_at` per identifier.
- **Cons:** a generic `channel` enum column is slightly less self-documenting than a dedicated table name; if channels diverge significantly in what metadata they need (e.g. forms needing a hashed token, not a plaintext identity — see §4), the generic shape starts to strain.
- **Security risks:** same self-registration/ownership-verification risk as any of these options (see §4, §6) — this is a property of the *problem*, not the schema choice. Mitigated by the uniqueness constraint (no silent double-mapping) but not by ownership verification, which is a separate, required follow-up regardless of which option is chosen.
- **Migration required:** yes — one new table.
- **Testability:** good — a single, typed, constrained table is straightforward to write unit and gated-integration tests against (mirroring the pattern already used for `failed_ingestions`, see `DB_AUDIT_REPORT.md` §8).
- **Multiple sources per tenant:** clean — just multiple rows sharing a `tenant_id`.
- **Rotation/revocation:** clean — soft-delete a row (`deleted_at`), insert a new one; full history retained.
- **Ownership verification implications:** `verified_at` gives a natural place to record verification state, though the verification *mechanism* itself (confirming a tenant actually controls a number/mailbox) is out of scope for the schema and must be built separately (§6, §9).
- **Verdict:** recommended for WhatsApp + email (see §4). Not necessarily the right shape for form-source tokens (see §4, §9).

### Option C — Channel-specific tables (`whatsapp_numbers`, `inbound_mailboxes`, `form_source_tokens`, ...)

- **What it stores:** one purpose-built table per channel, each with column types and constraints tailored to that channel (e.g. a `CHECK` constraint enforcing E.164 format on `whatsapp_numbers.phone_number`; a hashed-token column on `form_source_tokens` with rotation/expiry columns that would be meaningless on a phone-number table).
- **How each channel would query it:** a channel-specific `SELECT tenant_id FROM whatsapp_numbers WHERE phone_number = $1`, etc. — no shared query shape.
- **Pros:** strongest per-channel type safety (a `CHECK` constraint can validate E.164 format at the DB layer, not just at the application layer); no risk of one channel's needs (e.g. token hashing) leaking into another's semantics; each table's RLS policy can be tuned precisely to that channel's access pattern if they ever diverge.
- **Cons:** 2-3 migrations instead of one; 2-3 RLS policy sets instead of one; every future channel needs its own new table, migration, and policy from scratch — the highest ongoing maintenance cost of the three options; duplicated boilerplate for what is, for WhatsApp and email specifically, functionally the same lookup shape.
- **Security risks:** lowest risk of cross-channel semantic leakage (e.g. accidentally applying a phone-number normalization rule to an email address, or vice versa), at the cost of more surface area to keep consistently secured across more tables.
- **Migration required:** yes — multiple new tables.
- **Testability:** fine, but 2-3x the test surface for what is largely the same underlying behavior for WhatsApp and email.
- **Multiple sources per tenant:** clean, same as Option B.
- **Rotation/revocation:** clean, and can be channel-tailored (e.g. token expiry only makes sense on `form_source_tokens`).
- **Ownership verification implications:** same as Option B, per-table instead of per-channel-value.
- **Verdict:** overkill for WhatsApp + email today (§4) — the two channels' lookup needs are genuinely identical (exact-match on a normalized string). Right-sized specifically for form-source tokens *if* that gets built (§4, §9), because tokens have real structural differences (hashing) that don't belong on a shared table with plaintext phone numbers/mailboxes.

---

## 4. Recommended minimal design

**Recommendation: Option B (`channel_identities`) for WhatsApp + email. Form-source tokens, if and
when built, get their own table (a narrow Option C, not folded into Option B) — see rationale
below and open question in §9.** This is unchanged from the original synthesis and remains
correct after the full three-way comparison above.

**Why `tenants.settings` JSONB (Option A) is insufficient:** it cannot give real uniqueness
enforcement without a migration anyway (so it doesn't actually save the cost it appears to save),
has no clean multi-value or soft-delete/audit model, and every additional channel bolts on more
ad-hoc JSONB structure rather than reusing one consistent lookup contract. It fails the "smallest
*safe*" bar, not just the "smallest" bar.

**Why channel-specific tables (Option C) are overkill right now:** WhatsApp and email have
*identical* lookup shapes — exact-match a normalized string, return a `tenant_id`, support
soft-delete and multiple values per tenant. Splitting them into two tables today buys type-level
purity (e.g. an E.164 `CHECK` constraint) at the cost of doubling migration/RLS/test surface for
no behavioral difference. If a channel's needs genuinely diverge later (forms — see below), split
it out *then*, not preemptively for channels that don't need it.

**Why forms are the exception, not folded into `channel_identities`:** security-lead's guidance
(preserved from the original review) is that phone numbers and mailbox addresses are public-ish
routing keys — normalize and store in plaintext, exact-match lookup, no hashing benefit. A form
source token is the opposite: it's a bearer credential that *should* be hashed, rotated, and
revoked the way `webhook_tokens` was designed in an earlier discussion. Storing a hashed secret
next to plaintext phone numbers in the same table risks the wrong policy (e.g. a "show mapped
identities in an admin UI" feature) leaking a token's hash where a phone number would be fine to
display, or vice versa applying token-rotation UX to a phone number where it doesn't make sense.
Keep these as two distinct schema decisions even if neither is built yet.

**Why Command Room is currently deferring implementation (unchanged from original recommendation,
reaffirmed after this expanded analysis, including the threat-scenario review in §11):** every
inbound channel today hardcodes `brandId=1` — there is no second tenant to route for. Building
`channel_identities` now, with nothing real to populate it with beyond a single backfilled row,
is exactly the "building for hypothetical future requirements" this project avoids elsewhere.
The design is sound and cheap to execute later; there is no product need to execute it today.

---

## 5. Proposed schema if needed

_Illustrative column shape only — not executable SQL, not a migration file. Any real migration
is drafted by database-lead and requires separate review + Command Room approval per standing
process (`DB_AUDIT_REPORT.md` logging required)._

**Table:** `channel_identities`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `gen_random_uuid()` default |
| `tenant_id` | uuid, NOT NULL | References `tenants(id)`, cascade delete |
| `channel` | text, NOT NULL | Constrained to a fixed set: `whatsapp`, `email` (forms explicitly excluded — see §4) |
| `identity_value` | text, NOT NULL | E.164-normalized phone number, or lowercased/trimmed mailbox address, depending on `channel` |
| `verified_at` | timestamptz, nullable | Set once ownership verification (§6, §9) is confirmed — NULL means "mapped but unverified," a real interim state, not an error state |
| `deleted_at` | timestamptz, nullable | Soft-delete, matches this repo's existing convention elsewhere |
| `created_at` | timestamptz, NOT NULL | `now()` default |

**Constraints:**
- Partial unique index: `UNIQUE (channel, identity_value) WHERE deleted_at IS NULL` — enforces exactly one *active* tenant per identity value; a soft-deleted row doesn't block re-mapping the same value to a different tenant later (transfer/offboarding scenario, see §11 #6).
- Lookup index: `(channel, identity_value)` — this is the hot path, hit on every inbound webhook/poll cycle, must be indexed regardless of the unique constraint above (a partial index doesn't necessarily serve a query with a different WHERE shape efficiently).

**Soft-delete / disabled-mapping posture:** `deleted_at IS NOT NULL` is the "disabled" state. There
is deliberately no separate `enabled` boolean — a mapping either exists and is active, or it's
soft-deleted. Simpler state machine, one less way to misconfigure it.

**RLS posture recommendation:** baseline RLS is mandatory on creation, per this project's own
standing rule that no new table ships Supabase-default-open — even though this document does not
propose changing any *existing* RLS policy. Recommended shape: no `anon` policy at all (this table
is never read by an unauthenticated client-facing path); a service-role/system read path for the
webhook handlers themselves (see next point); and a `authenticated` + tenant-scoped policy for any
future admin UI that lets a tenant manage their own mappings (`tenant_id = auth_tenant_id()`,
matching the pattern already used elsewhere per `DB_AUDIT_REPORT.md`).

**Service-role/system vs anon access:** the inbound lookup (webhook handler → resolve tenant) is a
trusted server-side operation, not a caller-facing one — it should run with the same Supabase
client posture Block 1.2a's `getTenantIdForBrand` already uses (the app's own Supabase client, not
`anon`-role browser access). No inbound webhook caller ever queries this table directly or is
returned its contents.

**How to avoid exposing mappings to public callers:** the table is never referenced in any
response body — webhook handlers use it purely to resolve an internal `tenantId` value, which
never round-trips back to the caller. No API route should ever list or search this table by
`identity_value` for an unauthenticated caller (that would let someone enumerate which numbers/
mailboxes exist).

**Backfill policy:** unchanged from the original recommendation — backfill must **not** be bundled
into the schema migration. The migration ships an empty table + constraints + baseline RLS only.
Backfilling tenant #1's real WhatsApp number/mailbox (if known) is a separate, manually-run,
separately-reviewed step, consistent with how `phase2_failed_ingestions_dead_letter` was applied
and logged (`DB_AUDIT_REPORT.md` §8).

**Ownership verification requirement before any second tenant goes live:** a row existing in this
table means "a tenant claimed this identity," not "we confirmed they own it." Per security-lead's
review, this table must not be treated as sufficient trust for real customer traffic across more
than one tenant until an ownership-verification mechanism (WhatsApp Business API number
verification, or a mailbox confirmation email/DNS check) is built and gates `verified_at` being
set. This is a hard requirement for production use with a second tenant, not a nice-to-have —
see §6 and §9.

---

## 6. Fallback behaviour

| Scenario | Behaviour |
|---|---|
| Unknown WhatsApp `phone_number_id` | **Fail closed.** Do not fall back to `DEFAULT_TENANT_ID`. Return `200 OK` to Meta (avoid webhook retry storms — Meta retries non-2xx aggressively) but do not process the message into any tenant's data. Internally dead-letter to `failed_ingestions` — see schema note below on the `tenant_id` NOT NULL implication this raises. |
| Unknown email mailbox/recipient | **Fail closed.** No HTTP response semantics apply the same way (depends on whether it's a provider webhook — respond `200`/`202` to the provider, same reasoning as WhatsApp — or the IMAP poll loop, where there's no response to give; the email is left unread/flagged for manual triage, not silently deleted). Dead-letter internally where the provider-webhook path allows it. |
| Unknown form source token (future, §4/§9) | **401/403.** Unlike WhatsApp/email, this is a synchronous request from a webhook config the tenant/integrator controls (Tally, Typeform) — returning a clear rejection lets them see and fix a misconfiguration immediately, consistent with the existing `401` behavior on a bad `WEBHOOK_SECRET` (`lib/formLeadCore.js:41-44`). Do not silently 200 a rejected form submission. |
| Disabled mapping (`deleted_at IS NOT NULL`) | Same as "unknown" for that channel — a disabled mapping must be indistinguishable from no mapping at all from the inbound handler's perspective. Fail closed. |
| Mapping lookup technical failure (DB outage, timeout) | **Fail closed, never fall back to `DEFAULT_TENANT_ID`.** A DB outage during lookup must not silently misroute traffic to tenant #1 — that would reintroduce exactly the bug this design fixes, just intermittently. Dead-letter (if the dead-letter path itself is reachable — see `engine.js`'s existing best-effort, non-throwing pattern for `recordFailedIngestion`) or, if the dead-letter write also fails, log loudly and drop; either is safer than a wrong tenant assignment. |
| Multiple mappings match | Should be structurally impossible given the partial unique index (§5). If it happens anyway (race condition before the constraint exists, or a bug), **fail closed and log a critical alert** — never pick one arbitrarily. Silently choosing between two tenants is a cross-tenant data leak waiting to happen. |
| Tenant exists but `brand_dna` is missing | Distinct from "unknown identity" — the mapping resolved to a real `tenant_id`, but that tenant has no `brand_dna` row. Mirrors `engine.js:98-100`'s existing behavior (`throw new Error('Critical: Brand DNA not found...')`) — **fail with an internal error, dead-letter, do not fall back to `brand_dna` id=1's tenant.** Falling back there would be exactly Block 1.2a's split-brain bug reappearing at a different layer. |
| Tenant exists but channel is not configured | Equivalent to "unknown identity" from the inbound handler's point of view — there is no mapping row, so there's nothing to distinguish this from a stranger messaging a number that happens not to be mapped. Fail closed. |
| Tenant is disabled/suspended | **Not currently representable** — the `tenants` table has no `suspended`/`active` boolean today (only `subscription_tier`, `trial_started_at` per `DB_AUDIT_REPORT.md`). If this design is built, resolution must be a two-step gate: (1) resolve `tenant_id` from `channel_identities`, (2) check tenant status before proceeding — but step (2) has no column to check against yet. Flagged as an open gap for §9, not solved by this document. |
| `DEFAULT_TENANT_ID` exists in env but request is production inbound | Must never be reachable from the mapping-resolution path once built, except as an explicit, gated local/dev bypass mirroring the existing pattern in `lib/authMiddleware.js:31-38` (`DEV_BYPASS_AUTH === 'true'`). This is a control to be added in the implementation slices (§7, 1.2d/1.2e) — it does not exist today, which is precisely why every Lane B channel except `/webhook/lead` currently has this as its *only* behavior. |

---

## 7. Implementation slicing proposal

| Slice | Scope | Files likely touched | Tests needed | Rollback | Risk | Command Room approval required before starting? |
|---|---|---|---|---|---|---|
| **1.2b** — docs/architecture decision only | This document. No code. | `claude-code-migration/docs/BLOCK_1_2B_TENANT_MAPPING_DECISION.md` | None (docs) | Revert the commit | None | No — this is the deliverable being reviewed right now |
| **1.2c** — schema/migration, if approved | Create `channel_identities` (§5) + baseline RLS, shipped inert (no controller reads it). Manual backfill of tenant #1's known identifiers as a separate, reviewed step. | New `supabase/migrations/*.sql` file; `DB_AUDIT_REPORT.md` entry | Gated integration test mirroring `tests/failedIngestions.migration.test.js`'s pattern (`RUN_DB_INTEGRATION_TESTS=true`) — constraint behavior, RLS policy contract, empty-table sanity | Drop the table — empty, no dependents, no application code references it yet | Low (inert — no behavior change to any live path) | **Yes** — explicit Command Room + database-lead sign-off, only once a second tenant/channel onboarding is real (§10) |
| **1.2d** — Meta WhatsApp webhook mapping | Wire `controllers/whatsapp.js` to a new `resolveTenantFromWhatsAppNumber(phoneNumberId)` (mirrors `getTenantIdForBrand` from 1.2a), implement fail-closed fallback behavior (§6) | `controllers/whatsapp.js`; likely a new export from `engine.js` or a new `lib/` file; `tests/whatsapp*.test.js` | Known-mapping success path; unknown/disabled `phone_number_id` fails closed (200 + dead-letter, no processing); DB-outage-during-lookup fails closed; cross-tenant isolation (tenant A's number never resolves to tenant B) | Revert commit — controller reverts to hardcoded `brandId=1`. Schema (1.2c) is unaffected/independent, no schema rollback needed. | Medium — first real behavior change to a live, traffic-bearing inbound channel; getting fail-closed semantics wrong risks silently dropping legitimate leads | **Yes** — explicit approval, separate from 1.2c |
| **1.2e** — email webhook / IMAP mapping | Wire `controllers/email.js` (and, separately, evaluate `lib/emailListener.js` given its structural one-mailbox-per-process limitation, §2) to `resolveTenantFromMailbox(address)` | `controllers/email.js`, possibly `lib/emailListener.js`; `tests/email*.test.js` | Same shape as 1.2d: known-mapping success, unknown/disabled recipient fails closed, DB-outage fails closed, cross-tenant isolation | Revert commit — reverts to hardcoded default | Medium — same reasoning as 1.2d | **Yes** — explicit approval, separate from 1.2c and 1.2d |
| **1.2f** — future form-source mapping | Only if genuine multi-tenant form-source need arises. Per §4, likely its **own** table (hashed token, not `channel_identities`), replacing the single global `WEBHOOK_SECRET` model for `/webhook/lead`. Needs its own design pass, not assumed here. | `lib/formLeadCore.js`, `controllers/leadWebhook.js`; new migration; new tests | Valid-token success, revoked/unknown token fails with 401/403 (not silent fail-closed-200, per §6's forms-specific reasoning), tenant A's token never resolves to tenant B | Revert commit; `WEBHOOK_SECRET` model remains as a fallback until this ships (no forced cutover) | Medium | **Yes** — separate design review, likely warrants its own decision doc given the token/hashing divergence noted in §4 |
| **Optional later slice — whatsapp-web.js (wwebjs) live client** | Explicitly **excluded** from 1.2d. The live handler in `server.js` (`client.on('message_create', ...)`) stays on its hardcoded default tenant, protected by the standing "reaches real devices via `client.sendMessage()`... augment only, do not touch the handler" guardrail, until a separate, later, explicit decision reopens that specific handler. | N/A until that separate decision | N/A until that separate decision | N/A | N/A until scoped | **Yes, and additionally requires reopening the standing augment-only guardrail itself** — a higher bar than the other slices |

---

## 8. Test strategy

None of the following exist yet — all are scoped for the implementation slices in §7, listed here
so the eventual PRs have a concrete target rather than rediscovering this list.

1. **Spoofed `x-tenant-id` ignored** — already covered for `/webhook/lead` by Block 1.2a
   (`tests/leadWebhook.test.js`); no new work here, listed for completeness/traceability.
2. **Spoofed body/query `tenant_id` ignored** — same channel, same coverage; also worth a
   regression test on the appendix-flagged internal-key-gated routes (`controllers/digest.js`,
   `controllers/tenants.js:getTenantStatus`) if/when those are addressed in a future block — not
   in scope for 1.2c-1.2f.
3. **Unknown WhatsApp `phone_number_id` fails closed** (1.2d) — assert no `smart_leads`/`contacts`
   row is written, `failed_ingestions` receives a dead-letter entry (schema-permitting, see §6),
   and the HTTP response to Meta is `200` (not a retry-inducing error).
4. **Disabled WhatsApp mapping fails closed** (1.2d) — same assertions as #3, with a soft-deleted
   mapping row as the fixture instead of no row at all.
5. **Known WhatsApp mapping derives correct tenant** (1.2d) — assert the resolved `tenantId`
   flows into the same downstream calls Block 1.2a established the pattern for (single source of
   truth, no divergence between contact/lead tenant).
6. **Unknown email recipient/mailbox fails closed** (1.2e) — mirrors #3 for the email channel.
7. **Known email mapping derives correct tenant** (1.2e) — mirrors #5.
8. **Unknown form source fails closed** (1.2f) — asserts `401`/`403`, not a silent `200`, per §6's
   forms-specific fallback reasoning.
9. **Known form source derives correct tenant** (1.2f).
10. **Tenant A's source cannot route to tenant B** — cross-tenant isolation test, one per channel
    (WhatsApp, email, and forms once 1.2f exists): map an identity to tenant A, assert it never
    resolves to tenant B under any input variation (case, whitespace normalization edge cases for
    phone/email).
11. **No `DEFAULT_TENANT_ID` used outside an explicit local/dev fallback** — a repo-wide-style
    assertion (mirroring how `DEV_BYPASS_AUTH` is explicitly gated in `lib/authMiddleware.js`)
    that the new resolution functions never fall through to `DEFAULT_TENANT_ID` in a
    production-configured test environment.
12. **`failed_ingestions` receives safe tenant behaviour where possible** — for the unknown/
    disabled/lookup-failure cases where a dead-letter write is attempted, assert it either
    succeeds with a clearly-marked "unmapped" state or fails without throwing (matching
    `engine.js`'s existing best-effort, non-throwing `recordFailedIngestion` pattern) — never a
    write that guesses at a `tenant_id`.
13. **Mapping exists but `brand_dna` missing** — assert the same "Critical: Brand DNA not found"
    failure path Block 1.2a already exercises for `/webhook/lead`, reused for WhatsApp/email once
    they're wired (1.2d/1.2e).
14. **Mapping lookup technical failure** (simulated DB error/timeout) — assert fail-closed, not a
    silent fallback, per §6.
15. **Duplicate active mapping blocked by uniqueness** — a gated integration test against the real
    partial unique index (1.2c), mirroring the `failed_ingestions` migration test pattern: attempt
    to insert two active rows for the same `(channel, identity_value)`, assert the second is
    rejected by the constraint, not by application-layer logic alone.

---

## 9. Open questions for Command Room

Only genuinely blocking decisions — everything else in this document is a design ready to execute
once these are answered.

1. **Defer implementation entirely (as currently recommended), or approve building the inert
   schema (1.2c) now?** Existing config (`tenants.settings` JSONB, per §1/§3 Option A) is
   insufficient regardless of timing — it cannot give real uniqueness or a clean audit/rotation
   model. The only real question is *when* a migration happens, not *whether* one is eventually
   needed for true multi-tenant WhatsApp/email routing — a lookup that needs to be exact-match,
   uniqueness-enforced, and fast on every inbound hit is not something JSONB does safely at this
   repo's schema-convention bar (§3 Option A verdict).
2. **When a second tenant/channel onboarding is real, approve the `channel_identities` migration
   (1.2c) as designed in §5?** Or request changes to the schema shape first?
3. **What must ownership verification look like before a mapping is trusted for production
   traffic with a second tenant?** (§5, §6, §11 scenarios #3/#6/#11 all depend on this.) This
   document does not propose a mechanism — WhatsApp Business API number verification and a
   mailbox confirmation email/DNS check are named as candidates in the original security-lead
   review, but the actual choice and its build cost are undecided and blocking for any real
   second-tenant rollout, independent of whether 1.2c ships early or late.
4. **Should form-source mapping (1.2f) share the `channel_identities` table, or get its own
   table?** §4 recommends "its own," because a bearer token needs hashing/rotation/expiry
   semantics that don't belong next to plaintext phone numbers/mailbox addresses. This needs
   explicit sign-off since it affects the shape of §5's schema if the decision goes the other way
   before 1.2c is built.
5. **Is there an existing or planned `tenants.status` (suspended/active) concept** this design
   should account for (§6's "tenant is disabled/suspended" fallback row currently has no column to
   check against)? If not planned elsewhere, does it belong in scope for 1.2c, or a separate,
   later addition?

---

## 10. Final recommendation

**Unchanged from the original recommendation, reaffirmed after the full expansion above,
including the §11 threat-scenario review — none of the 20+ scenarios surfaced a reason to build
now:**

- **Do not build the inert schema now.**
- **Defer mapping-table implementation** until a real second tenant/channel onboarding requirement
  exists — not before.
- **Treat Block 1.2a as the active exploit fix** — `/webhook/lead`'s tenant-spoofing bug is closed
  and shipped; nothing in this document changes that status.
- **Treat Block 1.2b as architecture/design complete once this document is committed** — no
  further Block 1.2 action is expected until Command Room explicitly triggers 1.2c per the open
  questions in §9.

**What happens next after this docs-only commit:**
1. This file is committed as-is (docs only, per the constraints on this task — no code, no
   migration, no RLS touched).
2. Block 1.2 (parent) is considered closed: 1.2a shipped the fix, 1.2b shipped the design and the
   deferral decision.
3. No further action is taken on WhatsApp/email/IMAP/wwebjs tenant routing until Command Room
   answers §9 and a real second-tenant/channel onboarding triggers 1.2c.
4. Block 1 continues to its next scoped item (outside this document's remit) — RLS/auth cleanup
   work not specific to Lane B tenant mapping.

---

## 11. Complex tenant-mapping use cases and threat scenarios

Twenty required scenarios plus three additional edge cases, specifically testing Lane B trusted
tenant derivation and multi-tenant routing safety — not general product or Decision Brain
scenarios. Each is evaluated against the recommended design (§4/§5, `channel_identities`) as
specified, i.e. **not yet built** — "expected behaviour" describes what the design should do once
implemented per §6/§7, and is explicit wherever a scenario cannot be handled safely without
further work beyond the schema alone.

| # | Scenario | Channel | Setup | Inbound identifier received | Expected tenant derivation | Expected failure behaviour if untrusted | Supported cleanly by `channel_identities`? | Tests | Schema/config implication |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Tenant has one WhatsApp number | WhatsApp | One active `channel_identities` row, `channel='whatsapp'` | Meta `phone_number_id` matching the mapped row | Resolves to that tenant | N/A (happy path) | Yes | Test #5 (§8) | None beyond base schema |
| 2 | Tenant has multiple WhatsApp numbers | WhatsApp | Two active rows, same `tenant_id`, different `identity_value` | Either `phone_number_id` | Both resolve to the same tenant | N/A | Yes — multi-row-per-tenant is a first-class case (§5) | Test #5 variant, asserting both rows resolve identically | None — this is exactly why Option A (single JSONB field) was rejected in §3 |
| 3 | Two tenants attempt to configure the same WhatsApp `phone_number_id` | WhatsApp | Tenant A already has an active mapping; Tenant B attempts to register the same `phone_number_id` | N/A (this is a config-time event, not an inbound message) | Tenant B's registration attempt must be **rejected** at write time | The partial unique index (§5) rejects the second active row | Yes, if the write path checks the constraint (not just relies on app-layer validation) | Test #15 (§8) — gated integration test against the real constraint | Confirms the partial unique index is non-negotiable, not optional |
| 4 | WhatsApp `phone_number_id` is unknown | WhatsApp | No matching row exists | An unmapped `phone_number_id` | **No tenant derived** | Fail closed: `200` to Meta, no processing, attempt dead-letter (§6) | Yes, cleanly — this is the table's core job | Test #3 (§8) | `failed_ingestions.tenant_id` NOT NULL constraint (per `DB_AUDIT_REPORT.md` §8) needs resolution — see note below table |
| 5 | WhatsApp mapping exists but is disabled | WhatsApp | Row exists with `deleted_at IS NOT NULL` | The (now-disabled) mapped `phone_number_id` | **No tenant derived** — must behave identically to "unknown" | Same as #4 | Yes | Test #4 (§8) | Confirms soft-delete, not a separate `enabled` boolean, is sufficient (§5 design choice) |
| 6 | WhatsApp number is transferred from Tenant A to Tenant B | WhatsApp | Tenant A's row is soft-deleted; a new active row is inserted for Tenant B with the same `identity_value` | The transferred `phone_number_id` | Resolves to Tenant B once the new row is active; resolves to nobody (fails closed) in any gap between the soft-delete and the new insert | During the gap: same as #4 | Yes — this is exactly what the partial unique index (`WHERE deleted_at IS NULL`) is designed to allow (§5) | New test: soft-delete + re-insert sequence, assert old lookups fail closed and new lookups succeed post-transfer | Confirms ownership-verification (§9) matters even more here — a transfer claimed by Tenant B must be verified before `verified_at` is set, or Tenant B could hijack a number mid-transfer by racing the config UI |
| 7 | Meta webhook includes spoofed or irrelevant tenant fields | WhatsApp | Attacker sends a webhook payload with a fabricated `tenant_id`-like field somewhere in the body (there is no real such field in Meta's schema, but nothing stops a malformed/attacker-crafted payload from including one) | Any inbound payload with extraneous fields | Such fields **must never be read** — derivation is exclusively `phone_number_id → channel_identities` lookup | N/A — this isn't a failure mode, it's a design invariant: no caller-supplied tenant field is ever consulted, mirroring Block 1.2a's `x-tenant-id` fix exactly | Yes, by construction, as long as implementation discipline holds | Regression test: assert an extraneous `tenant_id`-shaped field in the payload has zero effect on the resolved tenant | None — this is a code-discipline requirement, not a schema one |
| 8 | Email arrives to a known inbound mailbox | Email | Active `channel_identities` row, `channel='email'` | Recipient address matching the mapped row | Resolves to that tenant | N/A (happy path) | Yes | Test #7 (§8) | None |
| 9 | Email arrives to an unknown recipient | Email | No matching row | An unmapped recipient address | **No tenant derived** | Fail closed (§6) | Yes | Test #6 (§8) | Same `failed_ingestions` NOT NULL note as #4 |
| 10 | One tenant has multiple inbound email addresses | Email | Multiple active rows, same `tenant_id` | Any of the mapped addresses | All resolve to the same tenant | N/A | Yes | Test #7 variant | None |
| 11 | Two tenants accidentally use the same forwarding email | Email | Tenant A registers `leads@example.com` as their forwarding target; Tenant B later attempts to register the same address (e.g. both used a shared "leads@" convention without realizing) | N/A (config-time event) | Tenant B's registration is **rejected** | Same as #3 | Yes | Test #15 (§8) | Confirms the uniqueness constraint applies identically across channels — same index, same behavior, no channel-specific exception |
| 12 | IMAP listener runs for a mailbox mapped to a disabled tenant | Email/IMAP | A mailbox has an active `channel_identities` row, but the owning tenant is suspended (§6's "tenant disabled" gap) | Email arrives at that mailbox | Per §6: **should** fail closed, but the design as specified **cannot currently do this** — there is no `tenants.status` column to check (§9 open question #5) | Without a status column, the mapping resolves successfully and the message would incorrectly proceed to a suspended tenant | **No — explicit gap.** This scenario is not safely supported until §9's open question #5 is resolved. | Blocked on schema decision — cannot write a meaningful test until the status column (if approved) exists | **This is a genuine schema gap, stated plainly per instruction: `channel_identities` alone does not solve tenant-suspension enforcement. A `tenants.status` (or equivalent) column is required for this scenario to be handled safely, and is not currently in scope for 1.2c as specified in §5.** |
| 13 | Form webhook uses a valid source token | Forms | A `form_source_tokens`-equivalent row (1.2f, not `channel_identities` per §4) exists and is active | A valid bearer token | Resolves to the mapped tenant | N/A (happy path) | Only if 1.2f is built with its own table, per §4 — **not supported by `channel_identities` as designed**, by design | Test #9 (§8) | Confirms §4's decision to keep forms separate is load-bearing, not cosmetic |
| 14 | Form webhook uses an old/revoked source token | Forms | Token was rotated/revoked | The old token | **No tenant derived** | `401`/`403`, not a silent `200` (§6 — forms differ from WhatsApp/email here because the caller controls their own webhook config and benefits from an explicit error) | Same caveat as #13 — depends on 1.2f | Test #8 (§8) | Confirms tokens need explicit rotation/expiry columns `channel_identities` doesn't have (§4) |
| 15 | Form payload includes spoofed `body.tenant_id` | Forms | Attacker includes a `tenant_id` field in the form submission body | A form payload with a fabricated tenant field | Must never be read — mirrors #7 and Block 1.2a's existing fix | N/A — design invariant | Yes, by construction — this is already true today post-1.2a, and must remain true regardless of whether 1.2f is ever built | Already covered by test #2 (§8) | None — reaffirms 1.2a's fix must not regress when 1.2f is added later |
| 16 | Mapping lookup fails due to DB outage | Any (WhatsApp/email) | Simulated DB error/timeout during the `channel_identities` query | Any valid identifier | **No tenant derived, even though a valid mapping exists** — must not fall back to `DEFAULT_TENANT_ID` | Fail closed; dead-letter if reachable, drop with a loud log if not (§6) | Yes, by implementation discipline — the schema doesn't cause this, but the resolution function must handle it correctly | Test #14 (§8) | None — purely an application-layer discipline requirement, same class as #7 |
| 17 | Mapping succeeds but `brand_dna` is missing | WhatsApp/email | Valid, active mapping resolves a real `tenant_id`; that tenant has no `brand_dna` row | Any mapped identifier | Tenant resolved correctly, but the **engine call fails** downstream | Mirrors `engine.js:98-100`'s existing "Critical: Brand DNA not found" error — fail loudly, dead-letter, do **not** fall back to `brand_dna` id=1 (that would reintroduce Block 1.2a's exact split-brain bug at a different layer) | Yes — this is a downstream concern the mapping table correctly hands off to the existing engine behavior | Test #13 (§8) | None — confirms this is an engine-layer contract, not a mapping-table gap |
| 18 | Tenant is suspended or inactive but mapping still exists | WhatsApp/email | Same setup as #12, generalized beyond IMAP to any channel | Any mapped identifier for the suspended tenant | Should fail closed (§6) | **Same explicit gap as #12** — not achievable without a `tenants.status` column | No — explicit gap, same as #12 | Blocked, same as #12 | Same as #12 — restates the gap generically rather than IMAP-specifically |
| 19 | Same customer contacts via WhatsApp and email for the same tenant | WhatsApp + Email | Tenant has one active row per channel (from #1 and #8) | Two separate inbound messages, one per channel, from the same real-world customer | Both independently resolve to the same tenant via two separate `channel_identities` lookups | N/A (happy path — this is a contact-deduplication concern, not a tenant-derivation one) | Yes — tenant derivation is correct and channel-independent; cross-channel contact matching (same customer, two channels) is a separate, existing concern (`upsertContact`'s email/phone matching logic in `controllers/leadWebhook.js`, unaffected by this design) | New test: two inbound events, different channels, same tenant, assert both resolve independently and correctly | None — confirms this design's scope boundary (tenant derivation) is cleanly separate from contact identity resolution (a different, already-existing mechanism) |
| 20 | `DEFAULT_TENANT_ID` exists but should not be used outside explicit local/dev fallback | Any | Production environment, `DEFAULT_TENANT_ID` env var still set (as it is today, for local/dev convenience) | Any inbound request | Resolution must go through `channel_identities` (or `brand_dna` for `/webhook/lead`) exclusively; `DEFAULT_TENANT_ID` must never be reached from a production-configured resolution path | If somehow reached, this **is** the exact bug this whole document exists to prevent — must be treated as a critical regression, not a fallback | Yes, by implementation discipline mirroring `lib/authMiddleware.js`'s existing `DEV_BYPASS_AUTH` gating pattern (§6, §9) | Test #11 (§8) | None — this is the central invariant the entire design protects; explicitly named as its own test rather than assumed |
| 21 *(bonus)* | Same WhatsApp `phone_number_id` recycled by Meta/carrier without a deliberate tenant-to-tenant transfer | WhatsApp | A tenant fully offboards and releases a number; Meta/the carrier later reassigns the same real-world number to an unrelated third party who is *not* one of our tenants | The recycled `phone_number_id`, now belonging to a stranger in the real world but still possibly present as a soft-deleted row pointing at the old tenant | Should resolve to **no tenant** (soft-deleted = same as unknown, per #5) unless a new tenant deliberately re-registers it | Fails closed correctly *if* the old tenant's offboarding process actually soft-deletes the row — **this depends on offboarding being wired to write to this table, which is not yet designed** | Partially — the schema supports it; the offboarding workflow that must call it does not exist yet | New test, deferred until an offboarding flow exists | Flags that a tenant-offboarding process needs to be scoped as a dependency before this design is fully trustworthy in production, beyond just the inbound-webhook wiring in 1.2d/1.2e |
| 22 *(bonus)* | Form webhook traffic today, before 1.2f exists | Forms | Current, already-shipped state (Block 1.2a) | Any `x-tenant-id` header or body field | Resolves via `getTenantIdForBrand` (brand_dna), ignores all caller-supplied fields | N/A — this is the shipped, working state | Already covered, `tests/leadWebhook.test.js` (15/15 passing per 1.2a) | Sanity-check scenario confirming this document's scope (WhatsApp/email) doesn't regress 1.2a's already-closed fix |
| 23 *(bonus)* | Admin/future UI attempts to list or search `channel_identities` by `identity_value` for an unauthenticated caller | WhatsApp/email (config surface, not inbound) | A hypothetical future admin API endpoint | A search query containing a phone number or email | Must be **rejected** — no unauthenticated enumeration of mapped identities (§5) | 401/403 at the API layer; RLS as a second line of defense (no `anon` policy per §5) | Yes, if RLS is implemented as specified in §5 | New test, deferred until any such admin UI is built | Confirms §5's "no anon policy" recommendation is load-bearing, not incidental |

**Scenarios #12 and #18 are explicit, stated gaps:** `channel_identities` as currently designed
cannot safely handle a suspended/inactive tenant whose mapping is still active, because the
`tenants` table has no status column to check. This is not solved by this document — it is
surfaced as open question #5 in §9 and must be resolved (either by adding a status column to a
future revision of this design, or by an explicit decision that tenant suspension is handled
elsewhere, e.g. by deleting/soft-deleting the tenant's `channel_identities` rows as part of the
suspension workflow itself, which would need its own review). **None of the 20+ scenarios above
change the §10 recommendation to defer building** — the gaps found (tenant-status enforcement,
offboarding-triggered soft-delete, ownership verification) are all reasons to design carefully
when this *is* built, not reasons to build it sooner.
