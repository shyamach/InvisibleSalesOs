# Invisible Sales OS — Full Codebase Audit
**Date:** 2026-06-26  
**Auditor:** SaaS Developer Expert (Board-level review)  
**Scope:** All backend, frontend, AI pipeline, and infrastructure files  

---

## Executive Summary

The project has a strong conceptual foundation — event-driven lead triage, multi-channel ingestion, AI personalization — but the current implementation has **critical runtime-breaking bugs**, **security vulnerabilities with live credentials**, and **architectural conflicts** that would prevent it from running in any real environment. Many of the rules in the project DNA (Rule #1: tests, Rule #2: structured JSON) are currently violated.

Priority order for fixes: **Security → Broken Code → Architecture → AI Layer → Frontend**.

---

## 🔴 CRITICAL — Security (Fix Before Anything Else)

### S-1: Google Service Account Private Key in Source Code
**File:** `google-credentials.json`  
**Problem:** A real Google service account private key (`-----BEGIN PRIVATE KEY-----`) is sitting in the project root. The `.gitignore` only excludes `node_modules` — this file will be pushed to any remote repo.  
**Fix:**
```
# .gitignore — add these immediately
.env.local
.env
google-credentials.json
.wwebjs_auth/
users.json
```
Then rotate the Google service account key in the Google Cloud Console. Store it in `.env.local` as a base64 string:
```
GOOGLE_CREDENTIALS_BASE64=<base64-encoded JSON>
```
And load it in `sheets.js`:
```js
const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString());
const auth = new google.auth.GoogleAuth({ credentials, scopes: [...] });
```

### S-2: Supabase Credentials Hardcoded in Source File
**File:** `supabaseClient.js` lines 4–5  
**Problem:** Anon key is hardcoded with a comment "Hardcoded for testing only — remove after confirmation." It was never removed. Two other files also create Supabase clients from env vars, creating three competing instances.  
**Fix:** Delete `supabaseClient.js`. Create one canonical client:
```js
// lib/supabase.js
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
```
Import this everywhere. Delete the inline instantiation in `server.js` and the `db.js` one.

### S-3: No Authentication on the Dispatch API
**File:** `server.js` — `POST /api/responder/dispatch`  
**Problem:** Anyone who knows port 3001 exists can call this endpoint and send arbitrary WhatsApp messages from your business number. There is zero authentication.  
**Fix:** Add a middleware that validates a secret header before any sensitive route:
```js
const requireInternalKey = (req, res, next) => {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
app.post('/api/responder/dispatch', requireInternalKey, async (req, res) => { ... });
```

### S-4: WhatsApp Token Scope Not Validated
**File:** `.env.local`  
**Problem:** The `WHATSAPP_ACCESS_TOKEN` is a System User token with no documented expiry or scope restrictions. If leaked, someone can send messages to any phone number via your Meta Business Account.  
**Fix:** Restrict the System User token to `whatsapp_business_messaging` scope only in Meta Business Manager. Set a rotation reminder — these tokens can be made non-expiring but shouldn't be.

---

## 🔴 CRITICAL — Broken / Missing Code (Will Crash at Runtime)

### B-1: Missing `lib/` Directory — Two Dead Imports
**File:** `index.js` lines 4–5  
**Problem:**
```js
import { insertLead } from './lib/supabaseLeads.js';      // FILE DOES NOT EXIST
import { insertOutreach } from './lib/supabaseOutreach.js'; // FILE DOES NOT EXIST
```
The `lib/` directory doesn't exist. Running `node index.js` throws `ERR_MODULE_NOT_FOUND` immediately.  
**Fix:** Either create these files or replace the imports with the actual `db.js` functions. Since `db.js` already handles lead insertion, map accordingly:
```js
// Replace both imports with:
import { logInteractionToPipeline } from './db.js';
```

### B-2: `engine.js` Calls a Non-Existent Export from `db.js`
**File:** `engine.js` line ~97  
**Problem:**
```js
const databaseSync = await saveLeadAndLogToDatabase(...).catch(() => null);
```
`db.js` does not export `saveLeadAndLogToDatabase`. It exports `logInteractionToPipeline` and `checkLiveInventory`. This silently fails (the `.catch(() => null)` swallows the import error at module load, which actually means it'll crash before that).  
**Fix:** Change the call to match what `db.js` actually exports:
```js
const databaseSync = await logInteractionToPipeline({
  phone: structuredProfile.phone,
  query: structuredProfile.query,
  channel: incomingChannel,
  triage: { priority: structuredProfile.priority }
}).catch(() => null);
```

### B-3: `ingest.js` Controller Reads Fields That Engine Never Returns
**File:** `controllers/ingest.js` lines 40–43  
**Problem:**
```js
trackingId: engineResult.leadId,       // engine returns { success: true } — no leadId
classification: engineResult.profile.priority, // no profile field — will throw TypeError
score: engineResult.profile.qualification_score,
routeSelected: engineResult.profile.preferred_channel,
```
`engine.js` returns `{ success: true }` or `{ success: false, error: ... }`. Accessing `.profile` on it throws `TypeError: Cannot read properties of undefined`.  
**Fix:** Either have `engine.js` return the full profile on success:
```js
return { success: true, leadId: lead.id, profile: structuredProfile };
```
Or strip the fields from the `ingest.js` response.

### B-4: `email.js` Also Reads `engineResult.leadId` (Same Problem)
**File:** `controllers/email.js` line 31  
```js
console.log(`✅ [Email Wrapper]: Successfully processed lead. Tracking ID: ${engineResult.leadId}`);
```
Will log `undefined`. Not a crash but misleading. Same fix as B-3.

### B-5: `optimizer.js` Is a Shell — Never Does Anything
**File:** `optimizer.js`  
**Problem:** `runOptimization()` is defined but the body is completely empty (3 comments, zero implementation, never called anywhere). This is a dead file.  
**Fix:** Either implement it or remove it. It should be a scheduled cron job, not a one-off file. Phase it in properly when the `leads` table has enough `rejected` rows to learn from.

### B-6: No Test Suite — Rule #1 Violated
**File:** `package.json`  
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
The project DNA's Rule #1 is: *"No code is written without a corresponding test."* There are zero tests. Every module — `parser.js`, `AI_Triage.js`, `engine.js`, `Responder.js` — is untested.  
**Fix:** Install Vitest (compatible with ESM) and add tests for at minimum:
- `AI_Triage.js` — mock Anthropic, assert gatekeeper logic
- `parser.js` — feed it messy text, assert JSON shape
- `server.js` dispatch route — mock Supabase + WhatsApp client

```bash
npm install --save-dev vitest
```
```json
"test": "vitest run",
"test:watch": "vitest"
```

---

## 🔴 CRITICAL — Architecture Conflicts

### A-1: Two Competing WhatsApp Systems Running Simultaneously
**Files:** `server.js` (uses `whatsapp-web.js` / Puppeteer) + `controllers/whatsapp.js` (uses official Meta Cloud API)  
**Problem:** These are two completely different WhatsApp integrations:
- `server.js` scrapes WhatsApp Web via a headless Chrome browser. This is unofficial, violates WhatsApp ToS, and will break whenever WA updates their web client.
- `controllers/whatsapp.js` uses the official Meta Business Cloud API via webhooks — the correct production approach.

Both exist in the codebase simultaneously. They target different endpoints, authenticate differently, and both call `processLeadThroughCognitiveEngine`. Inbound messages could trigger the pipeline twice.  
**Fix (short-term):** Pick one. For a real SaaS product targeting SMEs: **use the Meta Cloud API exclusively** (`controllers/whatsapp.js`). The `whatsapp-web.js` approach is only acceptable for a personal-use tool.  
**Fix (long-term):** Once committed to Meta API, delete `server.js` and `CloudAuth.js`. Set up a proper webhook receiver in Express. The `.wwebjs_auth` directory (10,000+ cache files) should also be deleted and `.gitignore`'d.

### A-2: Three Separate Supabase Client Instantiations
**Files:** `supabaseClient.js`, `db.js`, `server.js` (inline)  
**Problem:** Three different Supabase client objects exist. If connection pooling or auth state changes in one, the others don't know. This also makes testing impossible.  
**Fix:** Single canonical export from `lib/supabase.js` (see S-2). All three files import from there.

### A-3: Two Separate Database Table Schemas for Leads
**Files:** `server.js` / `engine.js` → write to `smart_leads` + `smart_interactions`  
`db.js` → writes to `leads` + `outreach_logs`  
**Problem:** Depending on the code path, a lead gets written to different tables with different column names. `smart_leads` has `customer_name, company_name, product_interest, ptc_score, intent_category`. `leads` has `phone, query, priority, source_channel`. There's no join possible between them.  
**Fix (Data Head priority):** Decide on one schema. The `smart_leads` schema is more complete and matches the Rule #2 structured JSON requirement. Migrate `leads`/`outreach_logs` data into `smart_leads`/`smart_interactions`. Remove the `leads` table references from `db.js` or repurpose `db.js` to point at `smart_leads`.

### A-4: `engine.js` Uses Raw `pg.Pool` Alongside Supabase
**File:** `engine.js` lines 11–16  
**Problem:** `engine.js` opens its own raw `pg.Pool` connection to PostgreSQL and runs raw SQL queries (`client.query(...)`). This bypasses Supabase's RLS (Row-Level Security) policies, Auth context, and connection pooler. It also means two simultaneous connection pools to the same DB.  
**Fix:** Replace the raw pg queries with Supabase client calls. The `brand_dna` lookup should use:
```js
const { data: brandDna } = await supabase
  .from('brand_dna')
  .select('brand_name, brand_voice_guidelines')
  .eq('id', brandId)
  .single();
```

---

## 🟠 HIGH — AI / Prompt Layer Issues

### AI-1: RAG Vector Search Uses Random Fake Embeddings
**File:** `engine.js` lines 19–22  
**Problem:**
```js
function generateMockEmbedding() {
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}
```
The vector similarity search uses random numbers. This means it retrieves random knowledge chunks, not relevant ones. The RAG layer is entirely broken and would return wrong or misleading context to the writer.  
**Fix:** Implement real embeddings using Anthropic's `voyage-3` or OpenAI's `text-embedding-3-small`:
```js
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic();

async function generateEmbedding(text) {
  // Use a dedicated embeddings API or Voyage via Anthropic
  // For now, use Supabase's pg_net + openai extension, or:
  throw new Error("Real embedding service not yet wired up — do not call this until implemented.");
}
```
Until real embeddings are in place, skip the vector search entirely rather than passing garbage context to the writer.

### AI-2: `writer.js` Silently Ignores the RAG Context
**File:** `writer.js` `generateTailoredOutreach(profile)` — only accepts 1 parameter  
**Problem:** `engine.js` calls:
```js
const optimizedOutreachDraft = await generateTailoredOutreach(structuredProfile, combinedGuidelines);
```
But the function signature is `generateTailoredOutreach(profile)`. The second argument (the combined brand guidelines + RAG context) is silently dropped. All the work in Pass 4 of the engine is wasted.  
**Fix:**
```js
// writer.js
export async function generateTailoredOutreach(profile, brandContext = '') {
  const systemPrompt = `${brandContext}\n\nYou are an elite B2B Account Director...`;
  // ...
}
```

### AI-3: Anthropic Client Instantiated Inside Every Function Call
**File:** `AI_Triage.js` line 7, `Responder.js` line 7  
**Problem:** `new Anthropic(...)` is called on every single inbound message. This re-reads env vars, re-initializes the SDK, and creates garbage collection pressure at volume.  
**Fix:** Move to module-level singleton (as already done correctly in `parser.js` and `writer.js`):
```js
// At top of AI_Triage.js
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function performAITriage(bundle, media = null) { ... }
```

### AI-4: No Retry Logic on Any Anthropic API Call
**Files:** `parser.js`, `writer.js`, `AI_Triage.js`, `Responder.js`  
**Problem:** All four AI calls wrap in a single try/catch and return `null`/`false` on any error. A transient 529 (overloaded) or 500 from Anthropic permanently drops the lead with no retry.  
**Fix:** Implement exponential backoff. At minimum:
```js
async function callWithRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
}
```

### AI-5: `Responder.js` Model Comment Contradicts Code
**File:** `Responder.js` line 24  
```js
model: "claude-haiku-4-5-20251001", // Using Sonnet for top-tier copywriting
```
The comment says Sonnet, the code uses Haiku. This isn't necessarily wrong (Haiku is fine for short WhatsApp replies) but the misleading comment will cause confusion during debugging.  
**Fix:** Update the comment: `// Using Haiku for speed and cost efficiency on short WhatsApp drafts`

### AI-6: `LeadNormalizer.js` Is Redundant Dead Code
**File:** `LeadNormalizer.js`  
**Problem:** This module duplicates what `server.js`'s message handler already does — triage → insert into `smart_leads`. It's never imported anywhere in the current active flow.  
**Fix:** Delete it. If multi-channel normalization is needed, the pattern belongs inside `engine.js`.

---

## 🟡 MEDIUM — Frontend Issues

### F-1: Login Has No Actual Authentication
**File:** `frontend/src/app/login/page.tsx`  
**Problem:**
```tsx
<Button render={<Link href="/app/dashboard" />}>
  Send OTP &amp; Continue
</Button>
```
Clicking "Send OTP & Continue" navigates directly to the dashboard. No OTP is sent. No session is created. Any user can access the full dashboard by visiting `/app/dashboard` directly.  
**Fix:** Implement real auth with Supabase Auth:
```tsx
// Use Supabase's OTP flow
const { error } = await supabase.auth.signInWithOtp({ email });
```
Add a Next.js middleware at `src/middleware.ts` that redirects unauthenticated users to `/login`.

### F-2: All Dashboard Data Is Hardcoded Mock Data
**File:** `frontend/src/lib/mock-data.ts`  
**Problem:** Every metric on the dashboard ("2,847 leads", "$284,500 revenue", chart data) is hardcoded. The product looks functional in screenshots but shows no real data.  
**Fix:** Create Next.js API routes (or use Supabase client directly in server components) to fetch real data:
```ts
// src/app/app/dashboard/page.tsx — make it a Server Component
const { data: leads } = await supabase.from('smart_leads').select('count');
```

### F-3: File Upload on Pipeline Page Doesn't Actually Upload
**File:** `frontend/src/app/app/pipeline/page.tsx`  
**Problem:** Dropping files stages their names in React state (`setStagedFiles`) but never POSTs them to the backend. The `<input>` collects files, then they disappear.  
**Fix:** Add a FormData upload handler:
```tsx
const formData = new FormData();
files.forEach(f => formData.append('files', f));
await fetch('/api/pipeline/upload', { method: 'POST', body: formData });
```

### F-4: Integration Page Polls `/api/status` That Doesn't Exist
**File:** `frontend/src/app/app/integrations/page.tsx` line 6  
```ts
const STATUS_ENDPOINT = "/api/status";
```
There is no Next.js API route at `/api/status`. The frontend will always hit a 404, always show "disconnected."  
**Fix:** Either create `src/app/api/status/route.ts` as a Next.js route that proxies to the Express backend, or configure `NEXT_PUBLIC_API_URL` and point directly at `http://localhost:3001/api/status`.

### F-5: `Button` Uses Non-Standard `render` Prop
**File:** `frontend/src/app/login/page.tsx` line 126  
```tsx
<Button render={<Link href="/app/dashboard" />}>
```
This is the Base UI `render` prop pattern, but the project uses shadcn/ui's `Button` which is built on Radix, not Base UI. The `render` prop will be silently ignored and the button won't navigate.  
**Fix:** Use `asChild`:
```tsx
<Button asChild>
  <Link href="/app/dashboard">Send OTP &amp; Continue</Link>
</Button>
```
Or better, use a proper `onClick` handler that calls Supabase OTP.

### F-6: No Environment Variables Wiring Between Frontend and Backend
**Problem:** The Next.js frontend has no knowledge of where the Express backend lives. No `NEXT_PUBLIC_API_URL` is defined anywhere.  
**Fix:** Add to the frontend's `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```
And use it throughout:
```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/status`);
```

---

## 🟡 MEDIUM — Code Quality & Infrastructure

### Q-1: Duplicate Console Log in `server.js`
**File:** `server.js` lines ~52 and ~67  
"Valid human lead detected. Routing to AI Triage..." is logged twice due to a copy-paste artifact. The `@lid` filter block also appears after the pre-filter block, meaning it's unreachable code (the `return` before it exits first).  
**Fix:** Remove the duplicate log and the dead `@lid` filter block.

### Q-2: Puppeteer Runs in Non-Headless Mode
**File:** `server.js` line 30  
```js
headless: false, // Set to true once session pairing is fully verified
```
`headless: false` opens a real Chrome window. This cannot run on a server, in Docker, or in CI. The "once verified" comment suggests this was meant to be temporary.  
**Fix:** Change to `headless: true` (or `headless: 'new'` for newer Puppeteer versions).

### Q-3: `CloudAuth.js` Is Defined But Never Used
**File:** `CloudAuth.js`  
`SupabaseStore` class is built to persist WhatsApp sessions in Supabase (correct approach for multi-tenant). But `server.js` uses `LocalAuth` instead, writing sessions to the local `.wwebjs_auth` disk folder.  
**Fix (if keeping whatsapp-web.js):** Wire `CloudAuth.js` into `server.js`:
```js
import { SupabaseStore } from './CloudAuth.js';
const client = new Client({
  authStrategy: new RemoteAuth({ store: new SupabaseStore(), backupSyncIntervalMs: 300000 }),
  ...
});
```

### Q-4: Port Conflict — ENV Says 3000, Code Hardcodes 3001
**File:** `.env.local` sets `PORT=3000`. `server.js` hardcodes `app.listen(3001, ...)`.  
**Fix:**
```js
app.listen(process.env.PORT || 3001, () => { ... });
```

### Q-5: `google-credentials.json` Key Path Is Relative to CWD
**File:** `sheets.js` line 8  
```js
keyFile: "./google-credentials.json"
```
If the process is started from any directory other than the project root, this fails.  
**Fix:** Use `path.resolve(__dirname, 'google-credentials.json')` or (per S-1) use base64 env var instead.

### Q-6: `sheets.js` Spreadsheet ID Is Hardcoded
**File:** `sheets.js` line 20  
```js
const spreadsheetId = "1Hrq7SamGkbCnrSCxKdTNEJc8KJuarLh7FSrS7kkoJaQ";
```
Hardcoded IDs make it impossible to switch between staging and production sheets.  
**Fix:** Use `process.env.SPREADSHEET_ID` (already set in `.env.local` but not used).

### Q-7: No CORS Configuration in `server.js`
**File:** `server.js`  
`cors` is listed as a dependency in `package.json` but never imported or used in `server.js`. Cross-origin requests from the Next.js frontend (port 3000) to Express (port 3001) will be blocked by browsers.  
**Fix:**
```js
import cors from 'cors';
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
```

### Q-8: `.wwebjs_auth` Browser Cache Is 10,000+ Files in Project Root
**Problem:** The entire Chromium profile from WhatsApp Web (cache, cookies, IndexedDB) is sitting in the project directory. This bloats the repo, leaks session state, and means QR authentication is tied to one specific machine's disk.  
**Fix:** Add to `.gitignore`:
```
.wwebjs_auth/
```
Then implement `CloudAuth.js` (see Q-3) to store sessions in Supabase.

---

## Role-Based Fix Assignment

| Board Role | Priority Files to Fix |
|---|---|
| **CEO (Shyama)** | Review S-1, S-2, S-3 — these are compliance/legal risks |
| **CTO** | A-1 (pick one WhatsApp approach), A-4 (remove raw pg pool), Q-2 (headless mode), Q-7 (CORS), port conflicts |
| **AI Specialist** | AI-1 (real embeddings), AI-2 (writer.js signature), AI-3 (singleton clients), AI-4 (retry logic) |
| **Data Head** | A-3 (unify lead schema), B-1/B-2 (fix broken imports/exports), database RLS policies |
| **CRA (Chief Revenue Agent)** | F-1 (real auth), F-2 (live data), F-3 (working upload), F-4 (API status route) |
| **SysArch** | Q-3 (CloudAuth wiring), Q-8 (session storage), B-6 (test suite), infrastructure isolation |

---

## Priority Fix Order (for Cursor)

1. **Rotate all exposed credentials** (Google, Supabase, WhatsApp token) — do this manually now, before writing any code
2. Fix `.gitignore` to exclude `.env.local`, `google-credentials.json`, `.wwebjs_auth/`
3. Fix B-1 (missing `lib/` imports — will crash on startup)
4. Fix B-2 (wrong export name from `db.js`)
5. Fix A-1 (decide on one WhatsApp integration — recommend Meta Cloud API only)
6. Fix A-3 (unify to one DB schema: `smart_leads` + `smart_interactions`)
7. Fix S-2 (single Supabase client)
8. Fix AI-2 (`writer.js` must accept `brandContext` param)
9. Fix AI-1 (disable fake embeddings until real ones are wired)
10. Fix F-1 (Supabase Auth OTP flow)
11. Fix B-6 (add test suite — Vitest)
12. Fix remaining Medium items in any order
