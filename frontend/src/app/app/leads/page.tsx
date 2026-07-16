"use client";

/**
 * Leads — Full list of smart_leads from Supabase.
 * Real-time: updates when new leads arrive via Supabase Realtime.
 * Filter: ALL / HIGH / MEDIUM / LOW
 * Search: by customer name, company, or product interest
 * Design: Direction C — Warm & Trustworthy
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  Filter,
  Mail,
  MessageSquare,
  Plus,
  Search,
  Users,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  customer_name: string | null;
  company_name: string | null;
  product_interest: string | null;
  ptc_score: number | null;
  intent_category: string | null;
  triage_status: string | null;
  pipeline_stage: string | null;
  source_channel: string | null;
  detected_language: string | null;
  created_at: string;
}

type PriorityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPriority(score: number | null): "HIGH" | "MEDIUM" | "LOW" {
  if (!score) return "LOW";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const PriorityBadge = ({ priority }: { priority: "HIGH" | "MEDIUM" | "LOW" }) => {
  const styles = {
    HIGH:   { background: '#fdecea', color: '#c0392b' },
    MEDIUM: { background: '#fdf0e8', color: '#9b5e3c' },
    LOW:    { background: '#eef7f1', color: '#4a7c59' },
  }[priority];
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={styles}>
      {priority}
    </span>
  );
};

const PipelineStagePill = ({ stage }: { stage: string | null }) => {
  if (!stage) return null;
  const label = stage.replace(/_/g, " ");
  return (
    <span
      className="px-2 py-0.5 rounded-md text-xs font-medium capitalize"
      style={{ background: '#fdf3e7', color: '#c87941' }}
    >
      {label}
    </span>
  );
};

const LanguageBadge = ({ lang }: { lang: string | null }) => {
  if (!lang || lang.toLowerCase() === "en" || lang.toLowerCase() === "english") return null;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
      style={{ background: '#ede5d8', color: '#7a6a5a' }}
    >
      {lang}
    </span>
  );
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
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
      <p className="text-2xl font-bold tabular-nums" style={{ color: '#1c1612' }}>{value}</p>
      <p className="text-xs" style={{ color: '#7a6a5a' }}>{label}</p>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PriorityFilter>("ALL");

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("smart_leads")
      .select(
        "id, customer_name, company_name, product_interest, ptc_score, intent_category, triage_status, pipeline_stage, source_channel, detected_language, created_at"
      )
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) setLeads(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLeads();

    const channel = supabase
      .channel("leads-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "smart_leads" },
        fetchLeads
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLeads]);

  // ── Filtering + Search ────────────────────────────────────────────────────

  const filtered = leads.filter((lead) => {
    if (filter !== "ALL" && getPriority(lead.ptc_score) !== filter) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const fields = [
        lead.customer_name,
        lead.company_name,
        lead.product_interest,
        lead.source_channel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!fields.includes(q)) return false;
    }

    return true;
  });

  // ── Stat counts ───────────────────────────────────────────────────────────

  const statCards = [
    { label: "Total leads",    value: leads.length,                                                           icon: Users,        iconColor: '#c87941' },
    { label: "High priority",  value: leads.filter((l) => getPriority(l.ptc_score) === "HIGH").length,        icon: AlertCircle,  iconColor: '#c0392b' },
    { label: "Pending reply",  value: leads.filter((l) => l.pipeline_stage === "new").length,                 icon: Clock,        iconColor: '#9b5e3c' },
    { label: "Qualified",      value: leads.filter((l) => l.pipeline_stage === "qualified").length,           icon: CheckCircle,  iconColor: '#4a7c59' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-6" style={{ background: '#faf8f5' }}>

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#1c1612' }}>Leads</h1>
          <p className="text-sm mt-0.5" style={{ color: '#7a6a5a' }}>
            AI-triaged enquiries from WhatsApp and email
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          style={{ background: '#fdf3e7', color: '#c87941', border: '1px solid #ede5d8' }}
        >
          <Plus className="size-4" strokeWidth={1.5} /> New Lead
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4"
            style={{ color: '#b8a898' }}
            strokeWidth={1.5}
          />
          <input
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg bg-white focus:outline-none"
            style={{ border: '1px solid #ede5d8', color: '#1c1612' }}
            placeholder="Search name, company, product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Priority filter pills */}
        <div className="flex gap-1">
          {(["ALL", "HIGH", "MEDIUM", "LOW"] as PriorityFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
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
                {f === "ALL"
                  ? leads.length
                  : leads.filter((l) => getPriority(l.ptc_score) === f).length}
              </span>
            </button>
          ))}
        </div>

        <button
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-white"
          style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
        >
          <Filter className="size-4" strokeWidth={1.5} /> Filter
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-sm" style={{ color: '#b8a898' }}>
          Loading leads...
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="size-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#fdf3e7' }}
          >
            <Users className="size-7" style={{ color: '#c87941' }} strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold mb-1" style={{ color: '#1c1612' }}>No leads yet</h3>
          <p className="text-sm max-w-xs" style={{ color: '#7a6a5a' }}>
            {search || filter !== "ALL"
              ? "No leads match your current filter."
              : "New leads will appear here as they come in via WhatsApp or email."}
          </p>
        </div>
      )}

      {/* Leads table */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #ede5d8' }}>
          <div
            className="px-4 py-2.5"
            style={{ borderBottom: '1px solid #ede5d8', background: '#faf8f5' }}
          >
            <p className="text-xs" style={{ color: '#b8a898' }}>
              {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
              {search ? ` matching "${search}"` : ""}
            </p>
          </div>

          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #ede5d8', background: '#faf8f5' }}>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Contact</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Message preview</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Priority</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Channel</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Stage</th>
                <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>When</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const priority = getPriority(lead.ptc_score);
                const isEmail = lead.source_channel?.includes("email");

                return (
                  <Link
                    key={lead.id}
                    href={`/app/leads/${lead.id}`}
                    legacyBehavior
                  >
                    <tr
                      className="hover:bg-[#fdf9f5] transition-colors cursor-pointer"
                      style={{ borderBottom: '1px solid #f0e8df' }}
                    >
                      {/* Contact */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="size-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                            style={{ background: '#fdf3e7', color: '#c87941' }}
                          >
                            {(lead.customer_name ?? lead.company_name ?? "?")[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: '#1c1612' }}>
                              {lead.customer_name ?? "Unknown"}
                            </p>
                            {lead.company_name && (
                              <p className="text-xs truncate" style={{ color: '#7a6a5a' }}>
                                {lead.company_name}
                              </p>
                            )}
                          </div>
                          <LanguageBadge lang={lead.detected_language} />
                        </div>
                      </td>

                      {/* Message preview */}
                      <td className="py-3.5 px-4 max-w-[220px]">
                        <p className="text-sm truncate" style={{ color: '#7a6a5a' }}>
                          {lead.product_interest
                            ? `Interested in: ${lead.product_interest}`.slice(0, 60)
                            : lead.intent_category ?? "—"}
                        </p>
                      </td>

                      {/* Priority */}
                      <td className="py-3.5 px-4">
                        <PriorityBadge priority={priority} />
                      </td>

                      {/* Channel */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5" style={{ color: '#7a6a5a' }}>
                          {isEmail ? (
                            <Mail className="size-4" strokeWidth={1.5} />
                          ) : (
                            <MessageSquare className="size-4" strokeWidth={1.5} />
                          )}
                          <span className="text-xs capitalize">
                            {isEmail ? "Email" : "WhatsApp"}
                          </span>
                        </div>
                      </td>

                      {/* Pipeline stage */}
                      <td className="py-3.5 px-4">
                        <PipelineStagePill stage={lead.pipeline_stage} />
                      </td>

                      {/* Time ago */}
                      <td className="py-3.5 px-4">
                        <span className="text-xs" style={{ color: '#b8a898' }}>
                          {timeAgo(lead.created_at)}
                        </span>
                      </td>

                      {/* Action arrow */}
                      <td className="py-3.5 px-4">
                        <ArrowRight className="size-4" style={{ color: '#b8a898' }} strokeWidth={1.5} />
                      </td>
                    </tr>
                  </Link>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
