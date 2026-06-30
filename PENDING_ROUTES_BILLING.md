# Pending Routes — Billing Module

Add the following lines to `server.js` to activate the billing API.

---

## 1. Import the billing controller

Add to the import block at the top of `server.js` (after the existing controller imports):

```js
import { getPlans, getCurrentBilling, createCheckout } from './controllers/billing.js';
```

---

## 2. Register the three routes

Add after the existing `// ─── Invoice Routes` block:

```js
// ─── Billing Routes ───────────────────────────────────────────────────────────
app.get('/api/billing/plans',           getPlans);                            // public — no auth
app.get('/api/billing/current',         requireInternalKey, getCurrentBilling);
app.post('/api/billing/create-checkout', requireInternalKey, createCheckout);
```

---

## Notes

- `GET /api/billing/plans` is intentionally **public** — pricing data does not require authentication and is consumed by the public `/pricing` marketing page.
- `GET /api/billing/current` and `POST /api/billing/create-checkout` require `x-internal-key` — they access tenant data and should never be called directly from the browser.
- The Next.js proxy routes at `app/api/billing/*/route.ts` handle the key injection.

---

## Stripe wiring (when ready)

When wiring Stripe:
1. Install: `npm install stripe`
2. Add to `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PRICE_STARTER=price_...
   STRIPE_PRICE_GROWTH=price_...
   STRIPE_PRICE_ENTERPRISE=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
3. Replace the stub in `controllers/billing.js → createCheckout` with the Stripe session creation logic documented in that file's TODO comment.
4. Add a Stripe webhook handler:
   ```js
   app.post('/webhook/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
   ```
   This handler should verify the `stripe-signature` header and update `tenants.subscription_tier` on `checkout.session.completed`.
