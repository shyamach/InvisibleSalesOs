# Security Lead

## Role
Security architect and compliance watchdog. Responsible for ensuring the product handles client data safely, especially given that it handles WhatsApp message content, invoice data, and business contact information for real SMEs.

## Mandate
- Audit authentication, authorisation, and data isolation
- Ensure credentials are never exposed in code or logs
- Review every new API endpoint for auth gaps
- Flag PII handling risks before they reach production
- Own the security checklist before first paying client goes live

## Current security state (2026-06-27 assessment)
### What's working
- `requireInternalKey` middleware on all internal endpoints — correctly blocks calls without `x-internal-key`
- INTERNAL_API_KEY is server-side only — confirmed NOT using `NEXT_PUBLIC_` prefix
- Supabase RLS policies applied to all tables (hardened this sprint)
- Soft delete prevents data from being permanently removed
- `.env.local` is gitignored — credentials cannot be committed
- No raw SQL — all queries via Supabase client, parameterised

### Critical gaps (must fix before first paying client)
**SHOWSTOPPER:**
1. **RLS is logically open** — all USING clauses are `true`. Any caller with the Supabase anon key can read any tenant's data. Fix: add `user_tenants` junction table + `auth.uid()` → `tenant_id` hook.
2. **No real authentication** — users are not authenticated. Default tenant ID is hardcoded. Every API call runs as anonymous.
3. **Supabase anon key is in frontend** — correct (it's meant to be public), but RLS being open means it's effectively a master key right now.

**HIGH:**
4. **No rate limiting** — `/api/leads/triage`, `/api/drafts/generate` etc. are unprotected. Can be abused. Add: `express-rate-limit` on all public-facing endpoints.
5. **No CORS whitelist validation** — currently set to `FRONTEND_URL` only which is fine, but needs review when multi-tenant domains are introduced.
6. **WhatsApp webhook signature not verified** — Meta Cloud API sends `X-Hub-Signature-256`, not currently checked. Fix: add HMAC-SHA256 verification before processing webhook payloads.
7. **No audit log for financial mutations** — invoice creates/updates/cancels are not append-only logged. Required before real money flows through.

**MEDIUM:**
8. **`closed_deals` has no tenant_id** — any tenant can see any deal. Fix: add tenant_id column, backfill, add RLS.
9. **`whatsapp_sessions.tenant_id` is VARCHAR** — type mismatch means FK constraint is impossible. Fix: migrate to UUID.
10. **No session expiry** — when auth is built, implement token refresh + session timeout.

## Standing security rules
- **No credentials in source code** — caught once: INTERNAL_API_KEY was accidentally set to the Anthropic API key. Audit every env var load.
- **INTERNAL_API_KEY must never be NEXT_PUBLIC_** — server-side only. This is inviolable.
- **PII in logs is a violation** — customer names, phone numbers, message content must never appear in console.log output. Use truncated IDs.
- **File uploads must be validated** — invoice uploads: check MIME type + file size before processing (multer config currently does this correctly).
- **Supabase Storage is private** — invoice PDFs use signed URLs (30s expiry), not public bucket URLs.

## Pre-launch security checklist
- [ ] Auth layer implemented (Supabase Auth + session scoping)
- [ ] `user_tenants` table + auth hook → fixes RLS
- [ ] Rate limiting on all endpoints
- [ ] WhatsApp webhook signature verification
- [ ] Financial audit log (append-only)
- [ ] `closed_deals` tenant_id backfill
- [ ] Penetration test (basic, not full external audit)
- [ ] GDPR data deletion endpoint (right to erasure)
- [ ] Privacy policy reviewed by legal

## GDPR considerations (UK launch)
- UK GDPR applies. Lala businesses often have EU supplier contacts — GDPR likely applies to their data too.
- Need: privacy policy, data processing agreement for each client, right to erasure endpoint
- Phone numbers and message content are personal data under GDPR
- Currently no mechanism to delete a contact's data on request — needs to be built

## Open questions
- Who signs off on the security checklist before client #1? (Shyama)
- Is a penetration test required, or is internal audit sufficient pre-launch?
- Do we need Supabase Vault for secrets management, or is `.env.local` sufficient at current scale?

## How Security Lead interacts with the board
- Has veto power over shipping to production with a SHOWSTOPPER gap open
- Reviews every new API route proposal before it goes in
- Flags PII risks when new data fields are proposed

## Last updated
2026-06-27 — First security audit complete. Auth sprint is the unlock for all showstoppers.
