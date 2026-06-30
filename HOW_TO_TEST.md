# How to Test — Invisible Sales OS
**Last updated:** 2026-06-26

---

## 1. Automated Tests (Run Right Now)

These require zero external services — all Anthropic calls are mocked.

```bash
# From the project root
npm test              # runs once, exits with pass/fail
npm run test:watch    # re-runs on every file save (for development)
```

**What's covered:**
| Test File | What It Proves |
|---|---|
| `tests/AI_Triage.test.js` | Gatekeeper correctly scores HIGH leads, drops noise, retries on API error |
| `tests/dispatch.test.js` | Auth middleware blocks requests without correct `x-internal-key` |
| `tests/writer.test.js` | `brandContext` param is accepted, null returned on failure |

Expected output:
```
Test Files  3 passed (3)
Tests       13 passed (13)
```

---

## 2. Backend — Local End-to-End Test

### Prerequisites
1. Add `INTERNAL_API_KEY=your-secret-key-here` to `.env.local`
2. Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in `.env.local`
3. Ensure your `smart_leads` and `smart_interactions` tables exist in Supabase

### Run the Express server
```bash
node server.js
```

Wait for:
```
🟢 [WhatsApp]: Session fully operational.
🌐 [Gateway]: REST API online on port 3001
```

### Test the status endpoint
```bash
curl http://localhost:3001/api/status
# Expected: {"status":"connected","qr":null}
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

### Test the full engine pipeline
```bash
node index.js
```

This runs the hardcoded test lead through the full 4-pass pipeline and syncs to Supabase + Sheets. Check your Supabase `smart_leads` table for the inserted row.

### Test the dispatch endpoint (requires server running)
```bash
# First, find an interaction_id from your Supabase smart_interactions table
# Then:
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
Create `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Run
```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### Manual test checklist
- [ ] `/login` — enter your email, receive OTP, verify, land on `/app/dashboard`
- [ ] `/login` — try Google OAuth button (needs Google provider enabled in Supabase dashboard)
- [ ] `/app/dashboard` — metrics show real counts (0 if DB is empty, not mock "2,847")
- [ ] `/app/integrations` — WhatsApp status panel shows "disconnected" when server is off, "connected" when `node server.js` is running
- [ ] `/app/dashboard` directly without logging in — should redirect to `/login`
- [ ] `/app/pipeline` — drag a PDF onto the drop zone, verify file name appears in staged list

---

## 4. WhatsApp Live Test

> Only do this after the automated tests and backend tests pass.

1. Start the server: `node server.js`
2. A QR code is printed in terminal — scan it with your WhatsApp phone (Settings → Linked Devices)
3. From a **different** phone, send a business inquiry to your WhatsApp number:
   ```
   Hi, I'm looking for 200 units of protein powder for my gym chain. 
   Can you send me a quote?
   ```
4. Watch the terminal — you should see:
   - `📡 [Raw Event]`
   - `🧠 [System]: Valid human lead detected`
   - `🎯 [LEAD SAVED]: ID: <uuid>`
   - `🚀 [DRAFT READY]: Priority HIGH`
5. Check Supabase `smart_interactions` — the draft should appear with `direction: outbound_draft`
6. Use the dispatch endpoint to actually send it (or build a UI button)

### Noise filter test
Send: `Hi` — should be dropped by the pre-filter, no Anthropic call made.

---

## 5. Supabase Schema Check

Run these queries in the Supabase SQL editor to verify your tables exist:

```sql
-- Check smart_leads schema
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'smart_leads';

-- Check smart_interactions schema  
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'smart_interactions';

-- Verify brand_dna has a row (required for engine.js to work)
SELECT id, brand_name FROM brand_dna WHERE id = 1;
```

If `brand_dna` is empty, insert a seed row:
```sql
INSERT INTO brand_dna (id, brand_name, brand_voice_guidelines)
VALUES (1, 'Your Brand', 'Professional, concise, luxury supplement distributor voice.');
```

---

## 6. What Good Looks Like

| Layer | Green signal |
|---|---|
| Tests | `13 passed (13)` |
| AI Triage | Returns `{ success: true, data: { priority: "HIGH", score: 85+ } }` for business leads |
| DB Sync | Row appears in `smart_leads` within 2s of message |
| Draft | `smart_interactions` row with `direction: "outbound_draft"` |
| Frontend auth | OTP email arrives, login lands on dashboard |
| Dashboard | Shows real DB counts, not "2,847" |
