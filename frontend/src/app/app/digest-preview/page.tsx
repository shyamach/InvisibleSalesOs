"use client";

/**
 * /app/digest-preview — Weekly Digest preview page.
 *
 * Shows the last computed digest stats and lets the user trigger a manual send.
 * Digest sends automatically every Monday at 8am UTC.
 */

import { useEffect, useState, useCallback } from "react";
import { Mail, TrendingUp, TrendingDown, Minus, Send, RefreshCw, Clock } from "lucide-react";

interface DigestStats {
  tenant_name: string;
  week_start: string;
  week_end: string;
  leads_this_week: number;
  leads_last_week: number;
  lead_trend_pct: number | null;
  high_priority_count: number;
  medium_priority_count: number;
  leads_won: number;
  pending_drafts: number;
  invoices_sent: number;
  invoice_value_gbp: number;
  invoices_paid: number;
  top_leads_to_chase: Array<{
    customer_name: string;
    company_name: string;
    product_interest: string;
    ptc_score: number;
    days_since_contact: number | null;
  }>;
}

interface PreviewResponse {
  success: boolean;
  subject?: string;
  stats?: DigestStats;
  html_length?: number;
  error?: string;
}

function formatGBP(amount: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateRange(startIso: string, endIso: string) {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const start = new Date(startIso).toLocaleDateString("en-GB", opts);
  const end = new Date(endIso).toLocaleDateString("en-GB", opts);
  return `${start} – ${end}`;
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) {
    return <span className="text-slate-400 text-sm">no prev. data</span>;
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 text-sm font-semibold">
        <TrendingUp className="w-4 h-4" /> +{Math.round(pct)}% vs last week
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-red-500 text-sm font-semibold">
        <TrendingDown className="w-4 h-4" /> {Math.round(pct)}% vs last week
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-sm">
      <Minus className="w-4 h-4" /> flat vs last week
    </span>
  );
}

export default function DigestPreviewPage() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<DigestStats | null>(null);
  const [subject, setSubject] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/digest/preview");
      const data: PreviewResponse = await res.json();
      if (!data.success) {
        setError(data.error || "Failed to load digest preview.");
      } else {
        setStats(data.stats || null);
        setSubject(data.subject || "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleSendPreview = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/digest/send-preview", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("success", `Digest sent to ${data.email_sent_to} ✓`);
      } else {
        showToast("error", data.error || "Send failed.");
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === "success" ? "bg-green-600" : "bg-red-500"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mail className="w-6 h-6" />
            Weekly Digest Preview
          </h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Your digest sends every Monday at 8am UTC
          </p>
        </div>
        <button
          onClick={fetchPreview}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !stats && (
        <div className="space-y-4 animate-pulse">
          <div className="h-32 bg-muted rounded-xl" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
          </div>
        </div>
      )}

      {stats && (
        <div className="space-y-6">
          {/* Subject line preview */}
          {subject && (
            <div className="bg-slate-900 text-white rounded-xl p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Email Subject</div>
              <div className="font-medium">{subject}</div>
            </div>
          )}

          {/* Hero stat */}
          <div className="bg-white border border-border rounded-xl p-6 text-center">
            <div className="text-sm text-muted-foreground mb-1">
              Week of {formatDateRange(stats.week_start, stats.week_end)}
            </div>
            <div className="text-6xl font-black text-foreground my-2">
              {stats.leads_this_week}
            </div>
            <div className="text-base text-muted-foreground">new leads this week</div>
            <div className="mt-2">
              <TrendBadge pct={stats.lead_trend_pct} />
            </div>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.leads_won}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Leads Won</div>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{stats.invoices_sent}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Invoices Sent</div>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{formatGBP(stats.invoice_value_gbp)}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">Invoiced</div>
            </div>
          </div>

          {/* Top leads to chase */}
          {stats.top_leads_to_chase.length > 0 && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground text-sm">
                  🔴 Top {stats.top_leads_to_chase.length} to Chase This Week
                </h2>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {stats.top_leads_to_chase.map((lead, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-slate-50" : "bg-white"}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-foreground">{lead.customer_name}</div>
                        <div className="text-muted-foreground text-xs">
                          {lead.company_name}
                          {lead.product_interest ? ` · ${lead.product_interest}` : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-bold">
                          PTC {lead.ptc_score}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs font-semibold ${
                          lead.days_since_contact === null || lead.days_since_contact >= 7
                            ? "text-red-500"
                            : lead.days_since_contact >= 4
                            ? "text-amber-500"
                            : "text-muted-foreground"
                        }`}>
                          {lead.days_since_contact === null
                            ? "Never contacted"
                            : `${lead.days_since_contact}d ago`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending drafts */}
          {stats.pending_drafts > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
              <div className="text-amber-800 text-sm font-medium">
                💬 {stats.pending_drafts} message draft{stats.pending_drafts !== 1 ? "s" : ""} waiting for approval
              </div>
              <a
                href="/app/drafts"
                className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
              >
                Review →
              </a>
            </div>
          )}

          {/* Send button */}
          <div className="border-t border-border pt-6 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <Clock className="w-4 h-4 inline mr-1" />
              Last sent: <span className="font-medium">—</span>
            </div>
            <button
              onClick={handleSendPreview}
              disabled={sending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-60"
            >
              {sending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send me a preview now
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
