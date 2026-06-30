"use client";

/**
 * New Segment — creation form.
 * Lets users define filter rules to build a retention segment.
 * "Preview" calls Supabase directly to count + sample matching leads.
 * "Save" inserts into segments table and redirects to /app/segments.
 */

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  CheckCircle,
  Mail,
  MessageSquare,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { buildSegmentQuery, SegmentFilters } from "@/lib/segment-utils";

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const PIPELINE_STAGES = ["new", "contacted", "quoted", "negotiating", "won", "lost", "dormant"];

// ─── Preview result type ──────────────────────────────────────────────────────

interface PreviewResult {
  count: number;
  samples: { customer_name: string | null; company_name: string | null }[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewSegmentPage() {
  const router = useRouter();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "both">("whatsapp");

  // Filter state
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [ptcScoreMin, setPtcScoreMin] = useState<string>("");
  const [sourceChannel, setSourceChannel] = useState<"whatsapp" | "email" | "any">("any");
  const [daysSinceContact, setDaysSinceContact] = useState<string>("");
  const [daysSinceCreated, setDaysSinceCreated] = useState<string>("");

  // UI state
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Build filters object from form state ──────────────────────────────────

  function buildFilters(): SegmentFilters {
    const filters: SegmentFilters = {};
    if (selectedStages.length > 0) filters.pipeline_stage = selectedStages;
    if (ptcScoreMin !== "") filters.ptc_score_min = parseInt(ptcScoreMin, 10);
    if (sourceChannel !== "any") filters.source_channel = sourceChannel;
    if (daysSinceContact !== "") filters.days_since_contact = parseInt(daysSinceContact, 10);
    if (daysSinceCreated !== "") filters.days_since_created = parseInt(daysSinceCreated, 10);
    return filters;
  }

  // ── Toggle stage checkbox ─────────────────────────────────────────────────

  function toggleStage(stage: string) {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  }

  // ── Preview matching leads ────────────────────────────────────────────────

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      let query = supabase
        .from("smart_leads")
        .select("customer_name, company_name", { count: "exact" })
        .eq("tenant_id", TENANT_ID);

      if (selectedStages.length > 0) {
        query = query.in("pipeline_stage", selectedStages);
      }
      if (ptcScoreMin !== "") {
        query = query.gte("ptc_score", parseInt(ptcScoreMin, 10));
      }
      if (sourceChannel !== "any") {
        query = query.eq("source_channel", sourceChannel);
      }
      if (daysSinceContact !== "") {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(daysSinceContact, 10));
        query = query.lt("updated_at", cutoff.toISOString());
      }
      if (daysSinceCreated !== "") {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(daysSinceCreated, 10));
        query = query.gte("created_at", cutoff.toISOString());
      }

      query = query.limit(3);

      const { data, count, error } = await query;

      if (error) {
        showToast("error", "Preview failed — check your filters");
      } else {
        setPreview({
          count: count ?? 0,
          samples: (data ?? []).map((r) => ({
            customer_name: r.customer_name,
            company_name: r.company_name,
          })),
        });
      }
    } catch {
      showToast("error", "Unexpected preview error");
    } finally {
      setPreviewing(false);
    }
  };

  // ── Save segment ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) {
      showToast("error", "Please enter a segment name");
      return;
    }

    setSaving(true);
    try {
      const filters = buildFilters();
      const { error } = await supabase.from("segments").insert({
        tenant_id: TENANT_ID,
        name: name.trim(),
        description: description.trim() || null,
        filters,
        channel,
        lead_count: preview?.count ?? 0,
        last_run_at: null,
      });

      if (error) {
        showToast("error", "Failed to save segment");
      } else {
        router.push("/app/segments");
      }
    } catch {
      showToast("error", "Unexpected error saving segment");
    } finally {
      setSaving(false);
    }
  };

  const filters = buildFilters();
  const querySummary = buildSegmentQuery(filters);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Header
        title="New Segment"
        description="Define filter rules to target the right leads for your campaign"
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
        <div className="mx-auto max-w-2xl space-y-6">

          {/* Back link */}
          <Link
            href="/app/segments"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3" />
            Back to Segments
          </Link>

          {/* ── Section: Details ──────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Segment Details
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Name <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="e.g. Cold WhatsApp leads — no reply in 7 days"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  placeholder="Briefly describe what this segment targets and why..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            </div>
          </div>

          {/* ── Section: Outreach Channel ─────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Outreach Channel
              </p>
            </div>
            <div className="flex gap-3 px-5 py-5">
              {(["whatsapp", "email", "both"] as const).map((ch) => {
                const selected = channel === ch;
                const Icon = ch === "email" ? Mail : ch === "both" ? Zap : MessageSquare;
                const label = ch === "whatsapp" ? "WhatsApp" : ch === "email" ? "Email" : "Both";
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`flex flex-1 flex-col items-center gap-2 rounded-lg border px-3 py-4 text-xs font-medium transition-all ${
                      selected
                        ? "border-foreground/30 bg-foreground/[0.05] text-foreground ring-1 ring-foreground/20"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-5" strokeWidth={1.5} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Section: Filter Rules ─────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Filter Rules
              </p>
            </div>
            <div className="space-y-6 px-5 py-5">

              {/* Pipeline Stage */}
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Pipeline Stage</p>
                <div className="flex flex-wrap gap-2">
                  {PIPELINE_STAGES.map((stage) => {
                    const checked = selectedStages.includes(stage);
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => toggleStage(stage)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-all ${
                          checked
                            ? "border-foreground/30 bg-foreground/[0.06] text-foreground"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Leave blank to match all stages
                </p>
              </div>

              {/* Min PTC Score */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Minimum PTC Score
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0 – 100"
                    value={ptcScoreMin}
                    onChange={(e) => setPtcScoreMin(e.target.value)}
                    className="h-9 w-32 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {ptcScoreMin ? `Leads with PTC ≥ ${ptcScoreMin}` : "Any score"}
                  </span>
                </div>
              </div>

              {/* Source Channel */}
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Lead Source Channel</p>
                <div className="flex gap-2">
                  {(["any", "whatsapp", "email"] as const).map((sc) => {
                    const label = sc === "any" ? "Any" : sc === "whatsapp" ? "WhatsApp" : "Email";
                    return (
                      <button
                        key={sc}
                        type="button"
                        onClick={() => setSourceChannel(sc)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                          sourceChannel === sc
                            ? "border-foreground/30 bg-foreground/[0.06] text-foreground"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Days since last contact */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  No contact in last N days
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 7"
                    value={daysSinceContact}
                    onChange={(e) => setDaysSinceContact(e.target.value)}
                    className="h-9 w-24 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {daysSinceContact ? `Last contacted over ${daysSinceContact} days ago` : "Any recency"}
                  </span>
                </div>
              </div>

              {/* Created within last N days */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Created within last N days
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 30"
                    value={daysSinceCreated}
                    onChange={(e) => setDaysSinceCreated(e.target.value)}
                    className="h-9 w-24 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {daysSinceCreated ? `Leads created in the last ${daysSinceCreated} days` : "All time"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Live filter summary ───────────────────────────────────────── */}
          {Object.keys(buildFilters()).length > 0 && (
            <div className="rounded-lg border border-border/40 bg-foreground/[0.02] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Segment targets
              </p>
              <p className="mt-1 text-sm text-foreground">{querySummary}</p>
            </div>
          )}

          {/* ── Preview ──────────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Preview Matching Leads
              </p>
            </div>
            <div className="px-5 py-5">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={previewing}
                className="h-8 gap-1.5 text-xs"
              >
                <Search className="size-3.5" />
                {previewing ? "Previewing..." : "Preview Matching Leads"}
              </Button>

              {preview && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">
                      {preview.count} lead{preview.count !== 1 ? "s" : ""} match
                    </span>
                    {preview.count > 3 && (
                      <span className="text-xs text-muted-foreground">
                        (showing first 3)
                      </span>
                    )}
                  </div>
                  {preview.samples.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-border/40 bg-background px-3 py-2 text-xs"
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-foreground/70">
                        {(s.customer_name ?? s.company_name ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-foreground">
                        {s.customer_name ?? "Unknown"}
                      </span>
                      {s.company_name && (
                        <span className="text-muted-foreground">— {s.company_name}</span>
                      )}
                    </div>
                  ))}
                  {preview.count === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No leads match these filters. Try broadening your criteria.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Action bar ───────────────────────────────────────────────── */}
          <div className="flex items-center justify-between pb-8">
            <Link href="/app/segments">
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground">
                Cancel
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="h-9 gap-1.5 bg-foreground px-5 text-background hover:bg-foreground/90"
            >
              <CheckCircle className="size-3.5" />
              {saving ? "Saving..." : "Save Segment"}
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
