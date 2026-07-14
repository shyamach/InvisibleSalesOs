/**
 * controllers/billing.js — Billing & subscription controller.
 *
 * Exposes handlers:
 *   GET  /api/billing/plans            — public, no auth
 *   GET  /api/billing/current          — requireAuth
 *   POST /api/billing/create-checkout  — requireAuth → redirects to Stripe Checkout
 *   POST /webhook/stripe               — raw body, Stripe signature verified
 */

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

// Initialise Stripe — gracefully absent if key not set (dev without Stripe)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

// ─── Plan definitions ─────────────────────────────────────────────────────────
// Source of truth for all pricing. No DB dependency — update here when pricing changes.

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price_gbp: 49,
    price_monthly: 49,
    billing_label: 'per month',
    highlighted: false,
    badge: null,
    limits: {
      leads_per_month: 500,
      whatsapp_numbers: 1,
      team_members: 1,
    },
    features: [
      'Every WhatsApp message scored for buying intent — automatically',
      '500 AI-triaged leads per month',
      '1 WhatsApp number connected',
      'Quote and invoice generation in seconds',
      'Email inbox scanning for inbound enquiries',
      '1 team member',
      'Standard email support',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price_gbp: 149,
    price_monthly: 149,
    billing_label: 'per month',
    highlighted: true,
    badge: 'Most Popular',
    limits: {
      leads_per_month: null, // unlimited
      whatsapp_numbers: 3,
      team_members: 3,
    },
    features: [
      'Everything in Starter',
      'Unlimited AI-triaged leads — no monthly cap',
      '3 WhatsApp numbers connected',
      'Call logging with auto-summary',
      'Automated follow-up engine — chases leads so you don\'t have to',
      'Customer segments for targeted outreach',
      '3 team members',
      'Priority support (same-day response)',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price_gbp: 399,
    price_monthly: 399,
    billing_label: 'per month',
    highlighted: false,
    badge: null,
    limits: {
      leads_per_month: null, // unlimited
      whatsapp_numbers: null, // unlimited
      team_members: null, // unlimited
    },
    features: [
      'Everything in Growth',
      'Unlimited WhatsApp numbers and team members',
      'Custom Brand DNA per product line — AI learns your exact voice',
      'Full API access for custom integrations',
      'White-label — your logo, your domain',
      'Dedicated onboarding specialist',
      'Custom SLA and compliance reporting',
    ],
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

export async function getPlans(req, res) {
  return res.json({ plans: PLANS });
}

export async function getCurrentBilling(req, res) {
  if (!requireTenant(req, res)) return;
  const TENANT_ID = req.tenantId;

  try {
    // Fetch tenant subscription state
    const { data: tenant, error: tenantError } = await req.supabase
      .from('tenants')
      .select('subscription_tier, trial_started_at, settings')
      .eq('id', TENANT_ID)
      .single();

    if (tenantError || !tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    // This month's window
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Leads triaged this month
    const { count: leadsThisMonth } = await req.supabase
      .from('smart_leads')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_ID)
      .gte('created_at', monthStart);

    // Invoices created this month
    const { count: invoicesThisMonth } = await req.supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_ID)
      .gte('created_at', monthStart);

    // Trial days remaining
    let trialDaysRemaining = 0;
    if (tenant.trial_started_at) {
      const trialStart = new Date(tenant.trial_started_at);
      const daysSinceStart = Math.floor((now - trialStart) / (1000 * 60 * 60 * 24));
      trialDaysRemaining = Math.max(0, 14 - daysSinceStart);
    }

    // Resolve lead limit from plan
    const tier = tenant.subscription_tier || 'trial';
    const plan = PLANS.find((p) => p.id === tier);
    const leadsLimit = plan?.limits?.leads_per_month ?? 500; // default starter limit for trial

    return res.json({
      tier,
      trial_days_remaining: trialDaysRemaining,
      usage: {
        leads_this_month: leadsThisMonth ?? 0,
        leads_limit: leadsLimit,
        invoices_this_month: invoicesThisMonth ?? 0,
      },
      settings: tenant.settings ?? {},
    });
  } catch (err) {
    console.error('💥 [billing/getCurrentBilling]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Plan → Stripe price_data mapping ────────────────────────────────────────
// Using inline price_data so no pre-created Stripe products are required.
// Once you want permanent Price IDs in Stripe dashboard, create them there
// and set STRIPE_PRICE_STARTER / STRIPE_PRICE_GROWTH / STRIPE_PRICE_ENTERPRISE.
// The env-var path takes priority if set.

const STRIPE_PLAN_CONFIG = {
  starter: {
    env_price_id: process.env.STRIPE_PRICE_STARTER,
    price_data: {
      currency: 'gbp',
      unit_amount: 4900, // £49.00
      recurring: { interval: 'month' },
      product_data: {
        name: 'Invisible Sales OS — Starter',
        description: '500 AI-triaged leads/month · 1 WhatsApp number · Quotes & Invoices',
      },
    },
  },
  growth: {
    env_price_id: process.env.STRIPE_PRICE_GROWTH,
    price_data: {
      currency: 'gbp',
      unit_amount: 14900, // £149.00
      recurring: { interval: 'month' },
      product_data: {
        name: 'Invisible Sales OS — Growth',
        description: 'Unlimited leads · 3 WhatsApp numbers · Follow-up engine · 3 seats',
      },
    },
  },
  enterprise: {
    env_price_id: process.env.STRIPE_PRICE_ENTERPRISE,
    price_data: {
      currency: 'gbp',
      unit_amount: 39900, // £399.00
      recurring: { interval: 'month' },
      product_data: {
        name: 'Invisible Sales OS — Enterprise',
        description: 'Unlimited everything · White-label · API access · Dedicated support',
      },
    },
  },
};

export async function createCheckout(req, res) {
  if (!requireTenant(req, res)) return;
  const TENANT_ID = req.tenantId;

  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe not configured — STRIPE_SECRET_KEY missing' });
  }

  const { plan_id } = req.body || {};

  const planConfig = STRIPE_PLAN_CONFIG[plan_id];
  if (!planConfig) {
    return res.status(400).json({ success: false, error: `Unknown plan: ${plan_id}. Must be starter, growth, or enterprise.` });
  }

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    // Build line_items — prefer pre-created Price ID, fall back to inline price_data
    const lineItem = planConfig.env_price_id
      ? { price: planConfig.env_price_id, quantity: 1 }
      : { price_data: planConfig.price_data, quantity: 1 };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [lineItem],
      success_url: `${FRONTEND_URL}/app/billing?upgraded=true&plan=${plan_id}`,
      cancel_url: `${FRONTEND_URL}/pricing`,
      metadata: {
        tenant_id: TENANT_ID,
        plan_id,
      },
      subscription_data: {
        metadata: { tenant_id: TENANT_ID, plan_id },
      },
      allow_promotion_codes: true,
    });

    console.log(`[billing] Checkout session created: ${session.id} for tenant ${TENANT_ID} plan ${plan_id}`);
    return res.json({ success: true, redirect_url: session.url });
  } catch (err) {
    console.error('[billing/createCheckout] Stripe error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * handleStripeWebhook — POST /webhook/stripe
 * Verifies the Stripe signature and processes checkout.session.completed.
 * Updates the tenant's subscription_tier and records the stripe_customer_id.
 *
 * IMPORTANT: This route must use express.raw() body parser (not express.json())
 * so Stripe can verify the signature against the raw body bytes.
 * Wire it in server.js BEFORE the global express.json() middleware.
 */
export async function handleStripeWebhook(req, res) {
  if (!stripe) {
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[stripe/webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
  }

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Dev mode: parse raw body as JSON without signature check
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { tenant_id, plan_id } = session.metadata || {};

    if (!tenant_id) {
      console.warn('[stripe/webhook] checkout.session.completed missing tenant_id in metadata');
      return res.json({ received: true });
    }

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          subscription_tier: plan_id || 'growth',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenant_id);

      if (error) throw error;

      console.log(`✅ [stripe/webhook] Tenant ${tenant_id} upgraded to ${plan_id}`);
    } catch (err) {
      console.error('[stripe/webhook] Failed to update tenant subscription:', err.message);
      // Return 200 anyway — Stripe will retry if we 5xx
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const tenantId = subscription.metadata?.tenant_id;
    if (tenantId) {
      await supabase
        .from('tenants')
        .update({ subscription_tier: 'trial', updated_at: new Date().toISOString() })
        .eq('id', tenantId);
      console.log(`[stripe/webhook] Subscription cancelled for tenant ${tenantId} — reverted to trial`);
    }
  }

  return res.json({ received: true });
}
