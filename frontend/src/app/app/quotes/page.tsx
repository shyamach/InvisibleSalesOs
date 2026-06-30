"use client";

/**
 * Quotes — List view for all quotes in the system.
 * Phase 1 feature: create, track, and manage sales quotes.
 * Real-time: subscribes to the quotes table via Supabase Realtime.
 * Design: Direction C — Warm & Trustworthy
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  FileText,
  Plus,
  ReceiptText,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Quote {
  id: string;
  quote_number: string | null;
  status: string;
  total: number;
  subtotal: number;
  currency: string;
  created_at: string;
  valid_until: string | null;
  lead_id: string | null;
  // joined from smart_leads
  lead_name: string | null;
  company_name: string | null;
}

type StatusFilter = "all" | "draft" | "sent" | "accepted";

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const quoteStatusStyles: Record<string, { background: string; color: string }> = {
  draft:    { background: '#f0e8df', color: '#7a6a5a' },
  sent:     { background: '#e6f0fb', color: '#185FA5' },
  accepted: { background: '#eef7f1', color: '#4a7c59' },
  rejected: { background: '#fdecea', color: '#c0392b' },
  expired:  { background: '#f5f5f5', color: '#888888' },
};

const StatusPill = ({ status }: { status: string }) => {
  const style = quoteStatusStyles[status] ?? { background: '#f0e8df', color: '#7a6a5a' };
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize"
      style={style}
    >
      {status}
    </span>
  );
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
}

const StatCard = ({ label, value, icon: Icon, iconColor }: StatCardProps) => (
  <div
    className="bg-white rounded-xl p-4 flex items-center gap-3"
    style={{ border: '1px solid #ede5d8' }}
  >
    <div
      className="size-10 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: '#fdf3e7' }}
    >
      <Icon className="size-5" style={{ color: iconColor }} strokeWidth={1.5} />
    </div>
    <div>
      <p className="text-xl font-bold tabular-nums" style={{ color: '#1c1612' }}>{value}</p>
      <p className="text-xs" style={{ color: '#7a6a5a' }}>{label}</p>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchQuotes = useCallback(async () => {
    const { data, error } = await supabase
      .from("quotes")
      .select(`
        id, quote_number, status, total, subtotal, currency,
        created_at, valid_until, lead_id,
        smart_leads (
          customer_name, company_name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[quotes] fetch error:", error.message);
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat: Quote[] = (data ?? []).map((row: any) => ({
      id: row.id,
      quote_number: row.quote_number,
      status: row.status ?? "draft",
      total: row.total ?? 0,
      subtotal: row.subtotal ?? 0,
      currency: row.currency ?? "GBP",
      created_at: row.created_at,
      valid_until: row.valid_until ?? null,
      lead_id: row.lead_id ?? null,
      lead_name: row.smart_leads?.customer_name ?? null,
      company_name: row.smart_leads?.company_name ?? null,
    }));

    setQuotes(flat);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchQuotes();

    const channel = supabase
      .channel("quotes-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, fetchQuotes)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchQuotes]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = filter === "all"
    ? quotes
    : quotes.filter((q) => q.status === filter);

  const counts: Record<StatusFilter, number> = {
    all:      quotes.length,
    draft:    quotes.filter((q) => q.status === "draft").length,
    sent:     quotes.filter((q) => q.status === "sent").length,
    accepted: quotes.filter((q) => q.status === "accepted").length,
  };

  const acceptedTotal = quotes
    .filter((q) => q.status === "accepted")
    .reduce((sum, q) => sum + q.total, 0);

  const pendingCount = quotes.filter((q) => q.status === "sent").length;

  const statCards: StatCardProps[] = [
    {
      label: "Total quotes",
      value: quotes.length,
      icon: FileText,
      iconColor: '#c87941',
    },
    {
      label: "Accepted value",
      value: acceptedTotal > 0 ? formatCurrency(acceptedTotal, quotes[0]?.currency ?? "GBP") : "£0.00",
      icon: TrendingUp,
      iconColor: '#4a7c59',
    },
    {
      label: "Awaiting response",
      value: pendingCount,
      icon: Clock,
      iconColor: '#9b5e3c',
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-6" style={{ background: '#faf8f5' }}>

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#1c1612' }}>Quotes</h1>
          <p className="text-sm mt-0.5" style={{ color: '#7a6a5a' }}>
            Send professional quotes in seconds
          </p>
        </div>
        <Link href="/app/quotes/new">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ background: '#c87941' }}
          >
            <Plus className="size-4" strokeWidth={1.5} /> New Quote
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 mb-4">
        {(["all", "draft", "sent", "accepted"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
            style={
              filter === f
                ? { background: '#c87941', color: '#ffffff' }
                : { background: '#ffffff', color: '#7a6a5a', border: '1px solid #ede5d8' }
            }
          >
            {f}
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
              style={
                filter === f
                  ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { background: '#faf8f5', color: '#b8a898' }
              }
            >
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-sm" style={{ color: '#b8a898' }}>
          Loading quotes...
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="size-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#fdf3e7' }}
          >
            <ReceiptText className="size-7" style={{ color: '#c87941' }} strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold mb-1" style={{ color: '#1c1612' }}>No quotes yet</h3>
          <p className="text-sm max-w-xs" style={{ color: '#7a6a5a' }}>
            {filter !== "all"
              ? `No ${filter} quotes found.`
              : "Create your first quote to get started."}
          </p>
          {filter === "all" && (
            <Link href="/app/quotes/new">
              <button
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ background: '#fdf3e7', color: '#c87941', border: '1px solid #ede5d8' }}
              >
                <Plus className="size-4" strokeWidth={1.5} /> Create Quote
              </button>
            </Link>
          )}
        </div>
      )}

      {/* Quotes table */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #ede5d8' }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #ede5d8', background: '#faf8f5' }}>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Quote</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Client</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Total</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Status</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Valid Until</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((quote) => (
                <tr
                  key={quote.id}
                  className="hover:bg-[#fdf9f5] transition-colors"
                  style={{ borderBottom: '1px solid #f0e8df' }}
                >
                  {/* Quote number + date */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="size-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: '#fdf3e7' }}
                      >
                        <FileText className="size-3.5" style={{ color: '#c87941' }} strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: '#1c1612' }}>
                          {quote.quote_number ?? "Draft"}
                        </p>
                        <p className="flex items-center gap-1 text-[11px]" style={{ color: '#b8a898' }}>
                          <CalendarDays className="size-3" strokeWidth={1.5} />
                          {formatDate(quote.created_at)}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Client */}
                  <td className="py-3.5 px-4">
                    <p className="text-sm" style={{ color: '#1c1612' }}>
                      {quote.lead_name ?? <span style={{ color: '#b8a898' }}>No lead</span>}
                    </p>
                    {quote.company_name && (
                      <p className="text-[11px]" style={{ color: '#b8a898' }}>
                        {quote.company_name}
                      </p>
                    )}
                  </td>

                  {/* Total */}
                  <td className="py-3.5 px-4">
                    <p className="text-sm font-semibold tabular-nums" style={{ color: '#1c1612' }}>
                      {formatCurrency(quote.total, quote.currency)}
                    </p>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4">
                    <StatusPill status={quote.status} />
                  </td>

                  {/* Valid until */}
                  <td className="py-3.5 px-4">
                    <span className="text-xs" style={{ color: '#b8a898' }}>
                      {formatDate(quote.valid_until)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const res = await fetch(`/api/invoices/from-quote/${quote.id}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({}),
                          });
                          const data = await res.json();
                          if (res.ok) {
                            window.location.href = `/app/invoices/${data.invoice.id}`;
                          } else {
                            alert(data.error || "Could not convert to invoice");
                          }
                        }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                        style={{ background: '#fdf3e7', color: '#c87941' }}
                        title="Convert this quote to an invoice"
                      >
                        <ArrowRight className="size-3" strokeWidth={1.5} /> Invoice
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
