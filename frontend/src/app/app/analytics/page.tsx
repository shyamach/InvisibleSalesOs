"use client";

/**
 * /app/analytics — Deep-dive performance metrics.
 *
 * Was entirely hardcoded (frontend/src/lib/mock-data.ts's dashboardMetrics,
 * plus inline fabricated channel-attribution/reply-performance numbers and a
 * randomly-generated 30-day chart) with zero API calls — every visitor saw
 * the same fake "2,847 leads / $284,500 revenue attributed" regardless of
 * their tenant's real data (this tenant's real total_leads is 13). Found
 * live 2026-08-25 QA pass; same fabricated-stats pattern as the previously
 * fixed /login and /pricing overclaims (see git history).
 *
 * Now sources the three headline cards from the same GET /api/dashboard/metrics
 * the dashboard page already uses (real, tenant-scoped, live). The channel-
 * attribution / reply-time / 30-day-trend breakdowns had no backend
 * equivalent to wire to — inventing that aggregation is a scoped feature,
 * not a QA fix — so those sections now show an honest "not available yet"
 * state instead of fabricated numbers.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { useAuth } from "@/components/AuthProvider";

interface TenantMetrics {
  total_leads: number;
  replies_received: number;
  drafts_approved: number;
  revenue_attributed: string | number;
}

function formatCurrency(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function EmptyPanel({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/50 p-6 ring-1 ring-border/40">
      <h3 className="text-sm font-medium tracking-tight">{title}</h3>
      <div className="mt-4 flex flex-col items-center justify-center gap-2 py-8 text-center">
        <BarChart3 className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-xs text-muted-foreground max-w-xs">{note}</p>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { getAuthHeaders } = useAuth();
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/dashboard/metrics", { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) {
        setMetrics(data.metrics ?? null);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <>
      <Header
        title="Analytics"
        description="Deep-dive performance metrics and attribution modeling"
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          {loadError && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              <span>Couldn&apos;t load analytics data.</span>
              <button onClick={() => fetchMetrics()} className="font-medium underline underline-offset-2">
                Retry
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              title="Total Leads"
              value={loading ? "—" : String(metrics?.total_leads ?? 0)}
              description="all-time, this tenant"
            />
            <MetricCard
              title="Automated Replies Sent"
              value={loading ? "—" : String(metrics?.drafts_approved ?? 0)}
              description="AI drafts approved & sent"
            />
            <MetricCard
              title="Revenue Attributed"
              value={loading ? "—" : formatCurrency(metrics?.revenue_attributed)}
              description="won deals, pipeline-linked"
            />
          </div>

          <EmptyPanel
            title="Inbound Inquiries vs Conversions"
            note="Day-by-day inquiry and conversion trend isn't available yet — this needs a dedicated time-series endpoint that hasn't been built."
          />

          <div className="grid gap-4 md:grid-cols-2">
            <EmptyPanel
              title="Channel Attribution"
              note="Per-channel lead breakdown isn't available yet."
            />
            <EmptyPanel
              title="Reply Performance"
              note="Reply-time distribution isn't available yet."
            />
          </div>
        </div>
      </main>
    </>
  );
}
