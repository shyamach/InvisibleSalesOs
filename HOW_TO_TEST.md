# How to Test — Invisible Sales OS
**Last updated:** 2026-07-02

_Companion docs: `Core Product & Vision/USE_CASE_TESTS.md` for scripted complex-scenario sessions (out-of-stock, price negotiation, etc.); the Notion "Testing Procedure" page (Team Procedures workspace) for the short version of this file plus Rule #1 framing._

---

## 1. Automated Tests (Run Right Now)

These require zero external services — all Anthropic calls are mocked.

```bash
# From the project root
npm test              # runs once, exits with pass/fail
npm run test:watch    # re-runs on every file save (for development)
```

**Expected baseline:** 308 tests passing across 27 files. This number drifts as the codebase grows — trust `npm test`'s live output over any number written in a doc, including this one. If the count is lower than expected, or anything is red, stop and fix before building anything new (Rule #1).

**What's covered (representative, not exhaustive — see `tests/` for the full list):**
| Test File | What It Proves |
|---|---|
| `tests/AI_Triage.test.js` | Gatekeeper correctly scores HIGH leads, drops noise, retries on API error |
| `tests/autoReply.test.js` | LOW/MEDIUM/HIGH decision logic, tenant config handling |
| `tests/channelRouter.test.js` | Reply-channel resolution cascade |
| `tests/catalogue.test.js` / `catalogueContext.test.js` | Stock math, no-oversell guard, AI context injection |
| `tests/escalation.test.js` | OOS/negotiation detection, outcome state machine |
| `tests/outbox.test.js` | Channel-resolved dispatch routing |

---

## 2. Backend — Local End-to-End Test

### Prerequisites
1. `.env.local` in the repo root has `INTERNAL_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` set.
2. Confirm your Supabase project has the current schema — check `DB_AUDIT_REPORT.md` for the migration list, not this file.

### Run the Express server
```bash
node server.js
```

**Before running:** check nothing else is already serving port 3001 — `lsof -i :3001 -sTCP:LISTEN` and `pm2 list`. This backend can end up managed by PM2 (`sales-os`) in addition to a manually-started process; see the Notion "Dev Environment Setup & Running the App" page for the full port-conflict runbook.

Wait for:
```
🌐 [Gateway]: REST API online → http://127.0.0.1:3001
🔗 [Webhook]:  Meta webhook URL → http://127.0.0.1:3001/webhook/whatsapp
```

### Test the status endpoint
```bash
curl http://localhost:3001/api/status
```

### Test the AI Triage pipeline manually (no WhatsApp needed)
```bash
node -e "
import('./AI_Triage.js').then(m =>
  m.performAITriage(['I need 500 units of whey protein for bulk distribution. Urgent pricing needed.']).then(r =>
    console.log(JSON.stringify(r, null, 2))
  )
);
"
```

Expected output shape:
```json
{
  "success": true,
  "data": {
    "is_lead": true,
    "priority": "HIGH",
    "score": 85,
    "reason": "...",
    "lead_data": { "customer_name": null, "product_interest": "whey protein" }
  }
}
```

### Test the full engine pipeline (no WhatsApp needed)

The old approach here (`node index.js`) no longer applies — `index.js` was a dead entry point removed in the 2026-07-02 cleanup (it imported two files that never existed). The current, real way to exercise the full `engine.js` pipeline end-to-end without WhatsApp is the generic form webhook, which is a live route used in production for Tally/Typeform-style leads:

```bash
curl -X POST http://localhost:3001/webhook/lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rajesh Gupta",
    "phone": "+447700900000",
    "email": "rajesh@example.com",
    "message": "Interested in bulk order of 500 boxes protein powder for my distribution chain. Need quote urgent.",
    "source": "test"
  }'
```

Check Supabase: a row should appear in `smart_leads` (triaged, scored), and a corresponding `smart_interactions` row with `direction: outbound_draft` (or a dispatched/auto-sent record, depending on the current auto-reply decision — see `Core Product & Vision/product.md` §4).

### Test the dispatch endpoint (requires server running)
```bash
# First, find an interaction_id from your Supabase smart_interactions table
curl -X POST http://localhost:3001/api/responder/dispatch \
  -H "Content-Type: application/json" \
  -H "x-internal-key: your-secret-key-here" \
  -d '{"interaction_id": "your-uuid-here"}'

# Without auth key — should return 401:
curl -X POST http://localhost:3001/api/responder/dispatch \
  -H "Content-Type: application/json" \
  -d '{"interaction_id": "test"}'
# Expected: {"success":false,"error":"Unauthorized"}
```

---

## 3. Frontend — Local Dev Test

### Setup
`frontend/.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Run
```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### Manual test checklist

Login is email/password + OAuth (Google/Microsoft), **not OTP** — this changed since Session 0; don't test for an OTP flow, it doesn't exist.

- [ ] `/login` — sign in with email/password, land on `/app/dashboard`
- [ ] `/login` — OAuth button (needs the provider enabled in the Supabase dashboard)
- [ ] `/app/dashboard` — metrics show real counts, not placeholder numbers
- [ ] `/app/dashboard` directly without logging in — should redirect to `/login`
- [ ] `/app/drafts` — the approval/exception inbox shows pending drafts, approve/edit/escalate actions work
- [ ] `/app/catalogue` — CRUD + stock adjust + CSV import
- [ ] `/app/escalations` — handoff queue, outcome buttons
- [ ] `/app/settings/auto-reply` — master toggle + per-priority rules reflect `product.md` §4's decision gate
- [ ] `/app/integrations` — WhatsApp status panel reflects whether the backend's WhatsApp client is actually connected

---

## 4. WhatsApp Live Test

> Only do this after the automated tests and backend tests pass.

1. Start the server: `node server.js` (checking for port conflicts first — see §2).
2. A QR code is surfaced (terminal log + the onboarding wizard's QR panel in the frontend) — scan it with the business WhatsApp number (Settings → Linked Devices).
3. From a **different** phone, send a business inquiry:
   ```
   Hi, I'm looking for 200 units of protein powder for my gym chain.
   Can you send me a quote?
   ```
4. Watch the terminal for the triage → draft → auto-reply-decision sequence.
5. Check Supabase `smart_interactions` for the resulting row (`outbound_draft` if held for review, a sent record if auto-dispatched per the LOW/exception rules in `product.md` §4).

### Noise filter test
Send: `Hi` — should be dropped by the pre-filter, no Anthropic call made.

### Complex scenarios
For out-of-stock, price negotiation, high-value orders, and the other named use cases, run the scripted sessions in `Core Product & Vision/USE_CASE_TESTS.md` rather than improvising — several of those are known gaps (marked 🔴/🟡), not yet-passing tests.

---

## 5. Supabase Schema Check

Run these in the Supabase SQL editor to sanity-check your project matches `DB_AUDIT_REPORT.md`:

```sql
-- Verify brand_dna has a row (required for engine.js to work)
SELECT id, brand_name, tenant_id FROM brand_dna WHERE id = 1;

-- Verify the dev tenant exists
SELECT id FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001';

-- products may legitimately be empty on a fresh project
SELECT count(*) FROM products;
```

If `brand_dna` is empty, insert a seed row and make sure `tenant_id` is set to the dev tenant — engine.js requires both.

---

## 6. What Good Looks Like

| Layer | Green signal |
|---|---|
| Tests | `npm test` reports all passing (308+ as of 2026-07-02) |
| AI Triage | Returns `{ success: true, data: { priority: "HIGH", score: 85+ } }` for business leads |
| DB Sync | Row appears in `smart_leads` within a few seconds of a message |
| Draft | `smart_interactions` row with `direction: "outbound_draft"`, or a sent record if auto-dispatched |
| Frontend auth | Email/password or OAuth login lands on `/app/dashboard` |
| Dashboard | Shows real DB counts |
| WhatsApp | `/api/status` and `/app/integrations` agree on connection state |
