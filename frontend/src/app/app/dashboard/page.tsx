"use client";

/**
 * Dashboard — Live revenue intelligence overview.
 * Direction C — Warm & Trustworthy palette.
 * Pulls from GET /api/dashboard/metrics (backend-aggregated tenant_metrics
 * VIEW + recent smart_leads + pipeline stage counts, tenant-scoped server-side).
 * Real-time subscription on smart_leads via Supabase Realtime (authenticated
 * client, triggers a refetch of the same endpoint).
 *
 * 2026-08-18 audit fix (Phase B item B2): previously queried Supabase
 * directly from the browser with an anon-key client and a hardcoded
 * default-tenant literal ("Lane C"). Also fixes a pre-existing field-name
 * mismatch — the old direct query expected `total_won`/`drafts_pending`,
 * but tenant_metrics actually returns `leads_won`/`pending_drafts`, so
 * those two stat cards always silently showed 0.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Users,
  CheckCircle,
  MessageSquare,
  FileText,
  Phone,
  BarChart3,
  ArrowRight,
  Receipt,
  PlusCircle,
} from "lucide-react";
import {
  pipelineStageBadgeClass,
  calculateReplyRate,
  formatCurrency,
  stageBarWidth,
  timeAgo,
  type PipelineStage,
} from "@/lib/dashboard-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TenantMetrics {
  tenant_id: string;
  tenant_name: string | null;
  total_leads: number;
  leads_this_week: number;
  high_priority_leads: number;
  leads_won: number;
  revenue_attributed: number | null;
  pending_drafts: number;
  drafts_approved: number;
  drafts_dismissed: number;
  replies_received: number;
  calls_logged: number;
  quotes_sent: number;
  pipeline_value: number | null;
}

interface RecentLead {
  id: string;
  customer_name: string | null;
  company_name: string | null;
  pipeline_stage: PipelineStage | null;
  ptc_score: number | null;
  source_channel: string | null;
  created_at: string;
}

interface StageCount {
  stage: PipelineStage;
  count: number;
}

const ALL_STAGES: PipelineStage[] = [
  "new",
  "contacted",
  "quoted",
  "negotiating",
  "won",
  "lost",
  "dormant",
];

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className ?? ""}`}
      style={{ background: '#ede5d8' }}
    />
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: '1px solid #ede5d8' }}>
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-20 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  context: string;
  icon: React.ElementType;
}

function StatCard({ label, value, context, icon: Icon }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl p-5" style={{ border: '1px solid #ede5d8' }}>
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: '#b8a898' }}
        >
          {label}
        </p>
        <div
          className="size-8 rounded-lg flex items-center justify-center"
          style={{ background: '#fdf3e7' }}
        >
          <Icon className="size-4" style={{ color: '#c87941' }} strokeWidth={1.5} />
        </div>
      </div>
      <p className="text-2xl font-semibold" style={{ color: '#1c1612' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: '#7a6a5a' }}>{context}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { getAuthHeaders } = useAuth();
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [stageCounts, setStageCounts] = useState<StageCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Previously no try/catch — a thrown fetch (network blip, or in dev a Fast
  // Refresh remount racing an in-flight request, or a Realtime event firing
  // fetchData while offline) skipped setLoading(false) and left the page
  // stuck on the skeleton forever. See the same fix on
  // frontend/src/app/app/invoices/page.tsx (2026-08-25) for the full story.
  const fetchData = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/dashboard/metrics", { headers: getAuthHeaders() });
      const data = await res.json();

      if (data.success) {
        setMetrics(data.metrics);
        setRecentLeads(data.recent_leads || []);
        setStageCounts(data.stage_counts || []);
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
    fetchData();

    const channel = supabase
      .channel("dashboard-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "smart_leads" },
        fetchData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  const replyRate = calculateReplyRate(
    metrics?.replies_received ?? 0,
    metrics?.drafts_approved ?? 0
  );

  const tenantName = metrics?.tenant_name ?? "there";
  const totalLeadsForStage =
    stageCounts.reduce((sum, s) => sum + s.count, 0) || 1;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Header
        title="Dashboard"
        description="Real-time revenue intelligence for your pipeline"
      />

      <main
        className="flex-1 overflow-y-auto p-4 sm:p-8"
        style={{ background: '#faf8f5' }}
      >
        <div className="mx-auto max-w-6xl space-y-6">

          {/* ── Page header ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div>
              <h1
                className="text-xl font-semibold"
                style={{ color: '#1c1612' }}
              >
                Good morning, {tenantName} 👋
              </h1>
              <p
                className="text-sm mt-0.5"
                style={{ color: '#7a6a5a' }}
              >
                Here&apos;s what&apos;s happening with your pipeline today.
              </p>
            </div>
            <div
              className="hidden sm:block text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ background: '#fdf3e7', color: '#c87941' }}
            >
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
          </div>

          {!loading && loadError && (
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3 text-sm"
              style={{ background: '#fdecea', color: '#c0392b', border: '1px solid #f5c6cb' }}
            >
              <span>Couldn&apos;t load dashboard metrics — numbers below may be stale or empty.</span>
              <button
                onClick={() => { setLoading(true); fetchData(); }}
                className="font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <>
              {/* Skeleton stat cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <StatCardSkeleton key={i} />
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <StatCardSkeleton key={i} />
                ))}
              </div>
              {/* Skeleton table */}
              <div
                className="rounded-xl bg-white p-5 space-y-3"
                style={{ border: '1px solid #ede5d8' }}
              >
                <Skeleton className="h-4 w-32" />
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* ── Row 1: 4 primary stat cards ────────────────────────── */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Pipeline Value"
                  value={formatCurrency(metrics?.pipeline_value ?? null)}
                  context={`${formatCurrency(metrics?.revenue_attributed ?? null)} attributed`}
                  icon={TrendingUp}
                />
                <StatCard
                  label="Leads This Month"
                  value={metrics?.total_leads ?? 0}
                  context={`${metrics?.leads_this_week ?? 0} new this week`}
                  icon={Users}
                />
                <StatCard
                  label="Quotes Sent"
                  value={metrics?.quotes_sent ?? 0}
                  context="formal quotes issued"
                  icon={FileText}
                />
                <StatCard
                  label="Reply Rate"
                  value={`${replyRate}%`}
                  context={`${metrics?.replies_received ?? 0} replies / ${metrics?.drafts_approved ?? 0} sent`}
                  icon={MessageSquare}
                />
              </div>

              {/* ── Row 2: Secondary stat cards ────────────────────────── */}
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Drafts pending — clickable */}
                <Link href="/app/drafts" className="group block">
                  <div
                    className="bg-white rounded-xl p-5 transition-shadow group-hover:shadow-sm"
                    style={{ border: '1px solid #ede5d8' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: '#b8a898' }}
                      >
                        Drafts Pending
                      </p>
                      <div
                        className="size-8 rounded-lg flex items-center justify-center"
                        style={{ background: '#fdf3e7' }}
                      >
                        <CheckCircle className="size-4" style={{ color: '#c87941' }} strokeWidth={1.5} />
                      </div>
                    </div>
                    <p className="text-2xl font-semibold" style={{ color: '#1c1612' }}>
                      {metrics?.pending_drafts ?? 0}
                    </p>
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#7a6a5a' }}>
                      awaiting approval
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </p>
                  </div>
                </Link>

                <StatCard
                  label="Won This Month"
                  value={metrics?.leads_won ?? 0}
                  context="closed deals"
                  icon={CheckCircle}
                />

                <StatCard
                  label="Calls Logged"
                  value={metrics?.calls_logged ?? 0}
                  context="call records"
                  icon={Phone}
                />
              </div>

              {/* ── Quick actions ───────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/app/quotes/new"
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                  style={{ background: '#c87941' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#b36a35'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#c87941'; }}
                >
                  <PlusCircle className="size-4" strokeWidth={1.5} />
                  New Quote
                </Link>
                <Link
                  href="/app/invoices/new"
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: '#fdf3e7', color: '#c87941', border: '1px solid #ede5d8' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#fbe8d0'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#fdf3e7'; }}
                >
                  <Receipt className="size-4" strokeWidth={1.5} />
                  New Invoice
                </Link>
                <Link
                  href="/app/drafts"
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ color: '#7a6a5a' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#1c1612'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#7a6a5a'; }}
                >
                  View all drafts
                  <ArrowRight className="size-3.5" strokeWidth={1.5} />
                </Link>
              </div>

              {/* ── Row 3: Recent leads + pipeline breakdown ────────────── */}
              <div className="grid gap-6 lg:grid-cols-3">

                {/* Recent Leads Table */}
                <div
                  className="lg:col-span-2 overflow-hidden rounded-xl bg-white"
                  style={{ border: '1px solid #ede5d8' }}
                >
                  <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{ borderBottom: '1px solid #ede5d8' }}
                  >
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#1c1612' }}>
                        Recent Leads
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#7a6a5a' }}>
                        Last {recentLeads.length} inbound leads
                      </p>
                    </div>
                    <Link
                      href="/app/leads"
                      className="flex items-center gap-1 text-xs font-medium transition-colors"
                      style={{ color: '#c87941' }}
                    >
                      View all
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>

                  {recentLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Users className="size-8" style={{ color: '#b8a898' }} strokeWidth={1.5} />
                      <p className="mt-3 text-sm" style={{ color: '#7a6a5a' }}>No leads yet</p>
                    </div>
                  ) : (
                    <div>
                      {recentLeads.map((lead) => (
                        <Link
                          key={lead.id}
                          href={`/app/leads/${lead.id}`}
                          className="flex items-center gap-3 px-5 py-3.5 transition-colors"
                          style={{ borderBottom: '1px solid #f5f0ea' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#faf8f5'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
                        >
                          {/* Avatar */}
                          <div
                            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                            style={{ background: '#fdf3e7', color: '#c87941', border: '1px solid #ede5d8' }}
                          >
                            {(lead.customer_name ?? lead.company_name ?? "?")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>

                          {/* Name + company */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium" style={{ color: '#1c1612' }}>
                              {lead.customer_name ?? "Unknown"}
                            </p>
                            {lead.company_name && (
                              <p className="truncate text-xs" style={{ color: '#7a6a5a' }}>
                                {lead.company_name}
                              </p>
                            )}
                          </div>

                          {/* Stage badge */}
                          <Badge
                            className={`shrink-0 border-0 text-[10px] font-medium uppercase tracking-wider ${pipelineStageBadgeClass(
                              lead.pipeline_stage
                            )}`}
                          >
                            {lead.pipeline_stage ?? "new"}
                          </Badge>

                          {/* Score */}
                          {lead.ptc_score !== null && (
                            <span
                              className="hidden w-10 text-right text-xs tabular-nums sm:block"
                              style={{ color: '#b8a898' }}
                            >
                              {lead.ptc_score}
                            </span>
                          )}

                          {/* Time ago */}
                          <span
                            className="w-14 shrink-0 text-right text-[11px]"
                            style={{ color: '#b8a898' }}
                          >
                            {timeAgo(lead.created_at)}
                          </span>

                          {/* View action */}
                          <span
                            className="hidden sm:flex shrink-0 items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                            style={{ background: '#fdf3e7', color: '#c87941' }}
                          >
                            View
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pipeline Stage Breakdown */}
                <div
                  className="rounded-xl bg-white"
                  style={{ border: '1px solid #ede5d8' }}
                >
                  <div
                    className="px-5 py-4"
                    style={{ borderBottom: '1px solid #ede5d8' }}
                  >
                    <div className="flex items-center gap-2">
                      <BarChart3 className="size-4" style={{ color: '#c87941' }} strokeWidth={1.5} />
                      <p className="text-sm font-semibold" style={{ color: '#1c1612' }}>
                        Pipeline Stages
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: '#7a6a5a' }}>
                      {stageCounts.reduce((s, c) => s + c.count, 0)} total leads
                    </p>
                  </div>

                  <div className="space-y-3 px-5 py-4">
                    {stageCounts.map(({ stage, count }) => (
                      <div key={stage} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize" style={{ color: '#7a6a5a' }}>{stage}</span>
                          <span className="tabular-nums font-medium" style={{ color: '#1c1612' }}>
                            {count}
                          </span>
                        </div>
                        <div
                          className="h-1.5 overflow-hidden rounded-full"
                          style={{ background: '#ede5d8' }}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${stageFillColor(stage)}`}
                            style={{
                              width: `${stageBarWidth(count, totalLeadsForStage)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

/** Returns a solid fill colour for the stage bar that matches the badge colour. */
function stageFillColor(stage: PipelineStage): string {
  switch (stage) {
    case "new":         return "bg-zinc-400";
    case "contacted":   return "bg-blue-400";
    case "quoted":      return "bg-amber-400";
    case "negotiating": return "bg-orange-400";
    case "won":         return "bg-emerald-400";
    case "lost":        return "bg-red-400";
    case "dormant":     return "bg-slate-400";
    default:            return "bg-zinc-300";
  }
}
