# Pending Routes — Onboarding

Add these two lines to `server.js` to wire up the tenant registration and status endpoints.

## 1. Import (add near the top, alongside other controller imports)

Place after the existing `import { logCall }` line (around line 39):

```js
import { registerTenant, getTenantStatus } from './controllers/tenants.js';
```

## 2. Routes (add after the existing Invoice Routes block, around line 97)

```js
// ─── Tenant Routes ─────────────────────────────────────────────────────────────
app.post('/api/tenants/register', requireInternalKey, registerTenant);
app.get('/api/tenants/:id/status',  requireInternalKey, getTenantStatus);
```

## Notes

- Both routes are protected by `requireInternalKey` middleware — the frontend calls
  them via the Next.js proxy routes (`/api/tenants` and `/api/tenants/[id]/status`)
  which inject the `x-internal-key` header server-side.
- The `registerTenant` endpoint returns `{ tenant_id, slug, setup_token }` with HTTP 201.
- The `getTenantStatus` endpoint returns `{ tenant, steps, completion_pct }`.
- `setup_token` is currently set to `tenant_id` — replace with a signed JWT
  when full auth is implemented.
- The `whatsapp_sessions` table check in `getTenantStatus` is wrapped in a try/catch
  and fails gracefully if the table does not yet exist in the database.
