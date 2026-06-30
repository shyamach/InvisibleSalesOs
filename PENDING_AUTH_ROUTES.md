# Routes to add to server.js

```js
import { requireAuth } from './lib/authMiddleware.js';
import { getMe, registerWithAuth } from './controllers/auth.js';

// Auth routes (add near the top of the route block, before lead routes)
app.get('/api/auth/me', requireAuth, getMe);
app.post('/api/auth/register', requireAuth, registerWithAuth);
```

## Existing routes to migrate from `requireInternalKey` → `requireAuth`

Once auth is fully wired end-to-end on the frontend, replace `requireInternalKey` with
`requireAuth` on these routes:

- All `/api/leads/*` routes
- All `/api/invoices/*` routes
- All `/api/quotes/*` routes
- `/api/billing/current`
- `/api/digest/*` routes

## Routes that KEEP `requireInternalKey`

Server-to-server calls (cron jobs, digest scheduler, internal automation) should
continue to use `requireInternalKey` — these are never called from a browser and
do not carry a Supabase JWT.
