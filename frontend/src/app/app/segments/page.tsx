"use client";

/**
 * Retention Segments — list page.
 * Shows all saved segments as cards. Each card has:
 *   • Channel badge (WhatsApp green / email blue / both orange)
 *   • Lead count + last run timestamp
 *   • Filter summary chips
 *   • "Run Campaign" button → inserts a segment_run + shows toast
 * Real-time: subscribes to `segments` table via Supabase Realtime.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Clock,
  Mail,
  MessageSquare,
  Plus,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";
import { filtersToDisplayText, SegmentFilters } from "@/lib/segment-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  id: string;
  name: string;
  description: string | null;
  filters: SegmentFilters;
  channel: string | null;
  lead_count: number | null;
  last_run_at: string | null;
  created_at: string;
  tenant_id: string;
}

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null) {
  if (!iso) return "Never run";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ChannelBadge({ channel }: { channel: string | null }) {
  if (channel === "email") {
    return (
      <Badge className="border-0 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider">
        <Mail className="mr-1 size-2.5" />
        Email
      </Badge>
    );
  }
  if (channel === "both") {
    return (
      <Badge className="border-0 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wider">
        <Zap className="mr-1 size-2.5" />
        Both
      </Badge>
    );
  }
  // default: whatsapp
  return (
    <Badge className="border-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
      <MessageSquare className="mr-1 size-2.5" />
      WhatsApp
    </Badge>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Fetch segments ───────────────────────────────────────────────────────────

  const fetchSegments = useCallback(async () => {
    const { data, error } = await supabase
      .from("segments")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    if (error) {
      showToast("error", "Failed to load segments");
      setLoading(false);
      return;
    }

    setSegments((data ?? []) as Segment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSegments();

    const channel = supabase
      .channel("segments-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "segments" }, fetchSegments)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchSegments]);

  // ── Run campaign ─────────────────────────────────────────────────────────────

  const handleRunCampaign = async (segment: Segment) => {
    setRunningId(segment.id);
    try {
      const { error } = await supabase.from("segment_runs").insert({
        tenant_id: TENANT_ID,
        segment_id: segment.id,
        leads_matched: segment.lead_count ?? 0,
        drafts_created: segment.lead_count ?? 0,
        channel: segment.channel || "whatsapp",
        status: "completed",
        ran_at: new Date().toISOString(),
      });

      if (error) {
        showToast("error", "Failed to queue campaign");
      } else {
        // Update last_run_at on the segment
        await supabase
          .from("segments")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", segment.id);

        showToast("success", "Campaign queued — drafts will appear in your Drafts queue");
        fetchSegments();
      }
    } catch {
      showToast("error", "Unexpected error starting campaign");
    } finally {
      setRunningId(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <Header
        title="Retention Segments"
        description="Re-engage cold leads with targeted campaigns built on smart filters"
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg transition-all ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {toast.type === "success" ? <CheckCircle className="size-4" /> : <X className="size-4" />}
          {toast.message}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 px-4 sm:p-8">
        <div className="mx-auto max-w-5xl">

          {/* Header row with New Segment button */}
          <div className="mb-6 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {!loading && `${segments.length} segment${segments.length !== 1 ? "s" : ""}`}
            </div>
            <Link href="/app/segments/new">
              <Button size="sm" className="h-8 gap-1.5 bg-foreground text-background hover:bg-foreground/90">
                <Plus className="size-3.5" />
                New Segment
              </Button>
            </Link>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
              Loading segments...
            </div>
          )}

          {/* Empty state */}
          {!loading && segments.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-24 text-center">
              <Target className="size-10 text-muted-foreground/40" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium text-foreground">No segments yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create one to start re-engaging cold leads.
              </p>
              <Link href="/app/segments/new" className="mt-4">
                <Button size="sm" variant="outline" className="h-8 gap-1.5">
                  <Plus className="size-3.5" />
                  Create your first segment
                </Button>
              </Link>
            </div>
          )}

          {/* Segments grid */}
          {!loading && segments.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {segments.map((seg) => {
                const filterChips = filtersToDisplayText(seg.filters ?? {});
                const isRunning = runningId === seg.id;

                return (
                  <div
                    key={seg.id}
                    className="overflow-hidden rounded-xl border border-border/60 bg-card/50 ring-1 ring-border/40 transition-all hover:ring-border/60"
                  >
                    {/* Card header */}
                    <div className="border-b border-border/40 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {seg.name}
                          </p>
                          {seg.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                              {seg.description}
                            </p>
                          )}
                        </div>
                        <ChannelBadge channel={seg.channel} />
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 border-b border-border/40 px-5 py-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="size-3" />
                        {seg.lead_count ?? 0} leads
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {timeAgo(seg.last_run_at)}
                      </span>
                    </div>

                    {/* Filter chips */}
                    {filterChips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-5 py-3">
                        {filterChips.map((chip, i) => (
                          <span
                            key={i}
                            className="rounded-md border border-border/50 bg-foreground/[0.03] px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 border-t border-border/40 bg-foreground/[0.01] px-5 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRunCampaign(seg)}
                        disabled={isRunning}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Zap className="size-3" />
                        {isRunning ? "Queuing..." : "Run Campaign"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
