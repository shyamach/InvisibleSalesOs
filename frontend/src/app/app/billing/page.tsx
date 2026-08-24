/**
 * /app/billing — Current plan overview for logged-in tenant.
 * Protected behind the /app/ layout which enforces authentication.
 *
 * Fetches from /api/billing/current (server-side proxy, keyed internally).
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard, TrendingUp, Zap } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingData {
  tier: "trial" | "starter" | "growth" | "enterprise";
  trial_days_remaining: number;
  usage: {
    leads_this_month: number;
    leads_limit: number | null;
    invoices_this_month: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_LABELS: Record<string, string> = {
  trial: "Free Trial",
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

const TIER_COLOURS: Record<string, string> = {
  trial: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  starter: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  growth: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
  enterprise: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

const GROWTH_UPGRADES = [
  "Unlimited AI-triaged leads — no monthly cap",
  "Automated follow-up engine — chases cold leads for you",
  "3 team members with shared inbox access",
  "Priority support with same-day response",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (!limit) {
    return (
      <div className="mt-2 text-xs text-zinc-500">No monthly limit on your plan</div>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const colour =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-zinc-800">
        <div
          className={`h-1.5 rounded-full transition-all ${colour}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {used} of {limit} used this month ({pct}%)
      </p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { getAuthHeaders } = useAuth();
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/current", { headers: getAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then((data) => setBilling(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [getAuthHeaders]);

  if (loading) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-500">Loading billing info...</p>
      </main>
    );
  }

  if (error || !billing) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">
          Could not load billing data: {error ?? "Unknown error"}
        </p>
      </main>
    );
  }

  const { tier, trial_days_remaining, usage } = billing;
  const isOnTrial = tier === "trial" || trial_days_remaining > 0;
  const tierLabel = TIER_LABELS[tier] ?? tier;
  const tierColour = TIER_COLOURS[tier] ?? TIER_COLOURS.starter;

  return (
    <main className="flex-1 overflow-y-auto bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-semibold text-foreground">
            <CreditCard className="size-5 text-muted-foreground" strokeWidth={1.5} />
            Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your subscription and track usage this month.
          </p>
        </div>

        {/* ── Trial warning ───────────────────────────────────────────── */}
        {isOnTrial && trial_days_remaining > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 shrink-0 text-amber-400 mt-0.5" strokeWidth={1.5} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-300">
                  {trial_days_remaining} day{trial_days_remaining !== 1 ? "s" : ""} left in your free trial
                </p>
                <p className="mt-1 text-sm text-amber-400/80">
                  Your trial ends soon. Upgrade now to keep all your leads, invoices, and settings.
                </p>
              </div>
              <Link
                href="/pricing"
                className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition-colors"
              >
                Upgrade now
              </Link>
            </div>
          </div>
        )}

        {isOnTrial && trial_days_remaining === 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-5 text-red-400" strokeWidth={1.5} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-300">Your trial has ended</p>
                <p className="mt-0.5 text-sm text-red-400/80">
                  Upgrade to continue receiving AI-triaged leads.
                </p>
              </div>
              <Link
                href="/pricing"
                className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
              >
                Upgrade now
              </Link>
            </div>
          </div>
        )}

        {/* ── Current plan ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/60 bg-foreground/[0.02] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Current Plan</p>
              <div className="mt-2 flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-foreground">{tierLabel}</h2>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tierColour}`}>
                  {tierLabel}
                </span>
              </div>
            </div>
            <Link
              href="/pricing"
              className="rounded-lg border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              View all plans
            </Link>
          </div>
        </div>

        {/* ── Usage this month ────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/60 bg-foreground/[0.02] p-6">
          <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Zap className="size-4 text-muted-foreground" strokeWidth={1.5} />
            Usage this month
          </h3>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">AI leads triaged</p>
                <p className="text-sm font-semibold text-foreground">
                  {usage.leads_this_month}
                  {usage.leads_limit ? ` / ${usage.leads_limit}` : " (unlimited)"}
                </p>
              </div>
              <UsageBar used={usage.leads_this_month} limit={usage.leads_limit} />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Invoices created</p>
                <p className="text-sm font-semibold text-foreground">{usage.invoices_this_month}</p>
              </div>
              <p className="mt-1 text-xs text-zinc-600">No limit on invoices.</p>
            </div>
          </div>
        </div>

        {/* ── What you'd get on Growth ─────────────────────────────────── */}
        {(tier === "trial" || tier === "starter") && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-6">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-indigo-300">
              <TrendingUp className="size-4" strokeWidth={1.5} />
              What you'd get on Growth →
            </h3>
            <p className="mb-4 text-xs text-indigo-400/70">£149/month. Everything on your current plan, plus:</p>
            <ul className="space-y-2.5">
              {GROWTH_UPGRADES.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-indigo-200/80">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-indigo-400" strokeWidth={2} />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/pricing"
              className="mt-5 block rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              Upgrade to Growth — £149/mo
            </Link>
          </div>
        )}

        {/* ── Billing history ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/60 bg-foreground/[0.02] p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Billing history</h3>
          <div className="rounded-lg border border-border/40 bg-background/20 p-8 text-center">
            <CreditCard className="mx-auto size-8 text-muted-foreground/30 mb-3" strokeWidth={1} />
            <p className="text-sm text-muted-foreground">No invoices yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              You'll see payment receipts here once you subscribe to a paid plan.
            </p>
          </div>
        </div>

      </div>
    </main>
  );
}
