# Pending Routes — Weekly Digest

Add the following lines to `server.js` to wire up the digest feature.
Do NOT edit server.js automatically — paste these manually.

---

## 1. Import block (add alongside other controller imports, near the top of server.js)

```js
import { getDigestPreview, sendDigestPreview } from './controllers/digest.js';
import { startDigestScheduler } from './lib/digestScheduler.js';
```

---

## 2. Route registrations (add alongside other /api/* routes)

```js
// ─── Digest routes ────────────────────────────────────────────────────────────
app.get('/api/digest/preview',      requireInternalKey, getDigestPreview);
app.post('/api/digest/send-preview', requireInternalKey, sendDigestPreview);
```

---

## 3. Scheduler startup (add inside the app.listen() callback, after the existing startup log)

```js
app.listen(PORT, () => {
  console.log(`🚀 [Server]: Listening on port ${PORT}`);

  // ... existing startup calls (emailListener, followUpEngine, etc.) ...

  // Weekly digest — fires every Monday at 8am UTC
  startDigestScheduler(supabase);
  console.log('📧 [Digest Scheduler]: Registered');
});
```

---

## Summary of files created

| File | Purpose |
|------|---------|
| `lib/weeklyDigest.js` | Core digest generator — stats queries, AI narrative, HTML builder |
| `lib/digestScheduler.js` | Hourly cron — fires Monday 8am UTC, one send per ISO week |
| `controllers/digest.js` | Express handlers for GET /api/digest/preview and POST /api/digest/send-preview |
| `frontend/src/app/api/digest/[...path]/route.ts` | Next.js catch-all proxy (adds x-internal-key) |
| `frontend/src/app/app/digest-preview/page.tsx` | Preview UI at /app/digest-preview |
| `tests/digest.test.js` | Vitest tests — all external calls mocked |

---

## Environment variables required

```
ANTHROPIC_API_KEY=   # for Claude Haiku narrative (already used elsewhere)
RESEND_API_KEY=      # already required by emailSend.js
RESEND_FROM_EMAIL=   # already required by emailSend.js
```

No new env vars needed — all keys are already in use by other features.

---

## Sidebar navigation (optional)

To add "Digest" to the sidebar in `frontend/src/components/layout/sidebar.tsx`,
add this entry to the `navItems` array:

```ts
import { Newspaper } from "lucide-react";

// In navItems array:
{ href: "/app/digest-preview", label: "Digest", icon: Newspaper },
```
