"use client";

/**
 * Lead Detail — Contact Timeline.
 * Shows full lead info, editable pipeline stage + deal value,
 * chronological activity timeline, and a Log Call modal.
 * Real-time: subscribes to lead_activities for this lead (authenticated
 * client, triggers a refetch of GET /api/leads/:id/activities).
 *
 * 2026-08-18 audit fix (Phase B item B2): previously queried/wrote Supabase
 * directly from the browser with an anon-key client and a hardcoded
 * default-tenant literal ("Lane C") — including fetchActivities, which had
 * no tenant filter at all, only a lead_id filter. The Log Call modal now
 * calls the real POST /api/calls (fixed the same day to be tenant-scoped
 * and authenticated), which also generates an AI follow-up draft for
 * "interested"/"callback" outcomes — a capability the old direct-insert
 * modal never had.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MessageSquare,
  Clock,
  CheckCircle,
  X,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  GitBranch,
  Activity,
} from "lucide-react";
import Link from "next/link";
import { pipelineStageBadgeClass, timeAgo, type PipelineStage } from "@/lib/dashboard-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  customer_name: string | null;
  company_name: string | null;
  pipeline_stage: PipelineStage | null;
  ptc_score: number | null;
  source_channel: string | null;
  deal_value: number | null;
  detected_language: string | null;
  created_at: string;
  tenant_id: string;
}

interface Activity {
  id: string;
  type: string;
  channel: string | null;
  direction: string | null;
  content: string | null;
  outcome: string | null;
  created_at: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  "new",
  "contacted",
  "quoted",
  "negotiating",
  "won",
  "lost",
  "dormant",
];

// Must match the DB CHECK constraint on call_logs.outcome exactly
// (controllers/calls.js's VALID_OUTCOMES) — the previous list here included
// values ("callback_requested", "left_voicemail", "converted", "other")
// that would have failed that constraint if ever actually submitted; found
// and fixed 2026-08-18 while wiring this modal to the real backend.
const CALL_OUTCOMES = [
  "interested",
  "not_interested",
  "callback",
  "won",
  "lost",
  "no_answer",
  "voicemail",
];

// ─── Activity icon ────────────────────────────────────────────────────────────

function ActivityIcon({ type, channel }: { type: string; channel: string | null }) {
  if (type === "call" || channel === "call") {
    return <PhoneCall className="size-3.5 text-violet-500" />;
  }
  if (type === "stage_change") {
    return <GitBranch className="size-3.5 text-blue-500" />;
  }
  if (channel?.includes("email")) {
    return <Mail className="size-3.5 text-amber-500" />;
  }
  return <MessageSquare className="size-3.5 text-emerald-500" />;
}

// ─── Log Call Modal ───────────────────────────────────────────────────────────

interface LogCallModalProps {
  leadId: string;
  onClose: () => void;
  onLogged: () => void;
}

function LogCallModal({ leadId, onClose, onLogged }: LogCallModalProps) {
  const { getAuthHeaders } = useAuth();
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [durationMins, setDurationMins] = useState("");
  const [outcome, setOutcome] = useState("interested");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);

    const durationSecs = durationMins ? Math.round(parseFloat(durationMins) * 60) : null;

    // POST /api/calls writes call_logs + lead_activities in one authenticated,
    // tenant-scoped call, and generates an AI follow-up draft for
    // "interested"/"callback" outcomes.
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        lead_id: leadId,
        direction,
        duration_secs: durationSecs,
        outcome,
        notes: notes.trim() || null,
      }),
    });
    const json = await res.json();

    if (!json.success) {
      setError(json.error || "Failed to log call");
      setSaving(false);
      return;
    }

    setSaving(false);
    onLogged();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-card shadow-xl ring-1 ring-border/40">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-foreground">Log a Call</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal body */}
        <div className="space-y-4 px-5 py-5">
          {/* Direction */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Direction
            </Label>
            <div className="flex gap-2">
              {(["outbound", "inbound"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors ${
                    direction === d
                      ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d === "outbound" ? (
                    <PhoneOutgoing className="size-3.5" />
                  ) : (
                    <PhoneIncoming className="size-3.5" />
                  )}
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label htmlFor="duration" className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Duration (minutes)
            </Label>
            <Input
              id="duration"
              type="number"
              min="0"
              step="0.5"
              placeholder="e.g. 5"
              value={durationMins}
              onChange={(e) => setDurationMins(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* Outcome */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Outcome
            </Label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
            >
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="call-notes" className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Notes
            </Label>
            <textarea
              id="call-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed? Any follow-up actions?"
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-foreground/20"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving}
            className="h-8 gap-1.5 bg-foreground text-background hover:bg-foreground/90"
          >
            <CheckCircle className="size-3.5" />
            {saving ? "Saving..." : "Log Call"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { getAuthHeaders } = useAuth();
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);

  // Editable fields
  const [stage, setStage] = useState<PipelineStage>("new");
  const [dealValue, setDealValue] = useState("");
  const [stageUpdating, setStageUpdating] = useState(false);
  const [dealValueUpdating, setDealValueUpdating] = useState(false);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Fetch lead ────────────────────────────────────────────────────────────

  // Previously no try/catch, and no way to tell "genuinely not found" apart
  // from "the fetch itself failed" — a thrown fetch (network blip, or in dev
  // a Fast Refresh remount racing an in-flight request) left `lead` null and
  // `loading` false, rendering the exact same "This lead could not be found"
  // page as a real 404. That produced a false "lead not found" alarm during
  // an earlier QA pass, only resolved by checking the DB directly. See the
  // same fix on frontend/src/app/app/invoices/page.tsx (2026-08-25) for the
  // fuller story on the stuck-loading half of this bug shape.
  const fetchLead = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { headers: getAuthHeaders() });
      const json = await res.json();

      if (json.success && json.lead) {
        setLead(json.lead as Lead);
        setStage((json.lead.pipeline_stage as PipelineStage) ?? "new");
        setDealValue(json.lead.deal_value?.toString() ?? "");
      } else if (!res.ok) {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [leadId, getAuthHeaders]);

  // ── Fetch activities ──────────────────────────────────────────────────────

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/activities`, { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) setActivities(json.activities as Activity[]);
    } catch {
      // Non-fatal — the activity timeline just stays at its last known state.
    }
  }, [leadId, getAuthHeaders]);

  useEffect(() => {
    fetchLead();
    fetchActivities();

    // Real-time for activities
    const channel = supabase
      .channel(`lead-activities-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lead_activities",
          filter: `lead_id=eq.${leadId}`,
        },
        fetchActivities
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, fetchLead, fetchActivities]);

  // ── Update stage ──────────────────────────────────────────────────────────

  async function handleStageChange(newStage: PipelineStage) {
    if (newStage === stage) return;
    const prevStage = stage;
    setStage(newStage);
    setStageUpdating(true);

    // PATCH /api/leads/:id logs the stage-change activity server-side in the
    // same call when pipeline_stage actually changes — no separate insert
    // needed here.
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ pipeline_stage: newStage }),
    });
    const json = await res.json();

    if (!json.success) {
      setStage(prevStage);
      showToast("error", "Failed to update stage");
    } else {
      showToast("success", `Stage updated to ${newStage}`);
      fetchActivities();
    }
    setStageUpdating(false);
  }

  // ── Update deal value ─────────────────────────────────────────────────────

  async function handleDealValueBlur() {
    const parsed = dealValue ? parseFloat(dealValue) : null;
    if (parsed === lead?.deal_value) return;
    setDealValueUpdating(true);

    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ deal_value: parsed }),
    });

    setDealValueUpdating(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header title="Lead" description="Loading..." />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </main>
      </>
    );
  }

  if (!lead && loadError) {
    return (
      <>
        <Header title="Couldn't load lead" description="" />
        <main className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">Something went wrong loading this lead — it may still exist.</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchLead(); }}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/app/leads")}>
              <ArrowLeft className="mr-2 size-4" />
              Back to Leads
            </Button>
          </div>
        </main>
      </>
    );
  }

  if (!lead) {
    return (
      <>
        <Header title="Lead not found" description="" />
        <main className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">This lead could not be found.</p>
          <Button variant="ghost" size="sm" onClick={() => router.push("/app/leads")}>
            <ArrowLeft className="mr-2 size-4" />
            Back to Leads
          </Button>
        </main>
      </>
    );
  }

  const initials = (lead.customer_name ?? lead.company_name ?? "?").slice(0, 2).toUpperCase();

  return (
    <>
      <Header
        title={lead.customer_name ?? lead.company_name ?? "Lead"}
        description={lead.company_name ?? "Contact Timeline"}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {toast.type === "success" ? <CheckCircle className="size-4" /> : <X className="size-4" />}
          {toast.message}
        </div>
      )}

      {showCallModal && (
        <LogCallModal
          leadId={leadId}
          onClose={() => setShowCallModal(false)}
          onLogged={fetchActivities}
        />
      )}

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Back link */}
          <Link
            href="/app/leads"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All Leads
          </Link>

          {/* ── Lead header card ──────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/60 bg-card/50 ring-1 ring-border/40">
            <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
              {/* Identity */}
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-foreground/[0.05] text-sm font-bold text-foreground/60">
                  {initials}
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {lead.customer_name ?? "Unknown"}
                  </h2>
                  {lead.company_name && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Building2 className="size-3.5" />
                      {lead.company_name}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {lead.source_channel && (
                      <span className="flex items-center gap-1">
                        {lead.source_channel.includes("email") ? (
                          <Mail className="size-3" />
                        ) : (
                          <MessageSquare className="size-3" />
                        )}
                        {lead.source_channel}
                      </span>
                    )}
                    {lead.ptc_score !== null && (
                      <span className="flex items-center gap-1">
                        <Activity className="size-3" />
                        PTC {lead.ptc_score}
                      </span>
                    )}
                    {lead.detected_language && (
                      <span className="uppercase">{lead.detected_language}</span>
                    )}
                    <span className="flex items-center gap-1 text-muted-foreground/60">
                      <Clock className="size-3" />
                      {timeAgo(lead.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCallModal(true)}
                className="h-8 shrink-0 gap-1.5"
              >
                <Phone className="size-3.5" />
                Log Call
              </Button>
            </div>

            <Separator className="opacity-60" />

            {/* Editable fields */}
            <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
              {/* Pipeline Stage */}
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  Pipeline Stage
                </Label>
                <div className="flex items-center gap-2">
                  <select
                    value={stage}
                    onChange={(e) => handleStageChange(e.target.value as PipelineStage)}
                    disabled={stageUpdating}
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50"
                  >
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                  <Badge
                    className={`shrink-0 border-0 text-[10px] font-medium uppercase tracking-wider ${pipelineStageBadgeClass(stage)}`}
                  >
                    {stage}
                  </Badge>
                </div>
              </div>

              {/* Deal Value */}
              <div className="space-y-2">
                <Label htmlFor="deal-value" className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  Deal Value (£)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    £
                  </span>
                  <Input
                    id="deal-value"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    onBlur={handleDealValueBlur}
                    disabled={dealValueUpdating}
                    className="h-9 pl-7 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Activity Timeline ──────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/60 bg-card/50 ring-1 ring-border/40">
            <div className="border-b border-border/40 px-5 py-4">
              <p className="text-sm font-medium text-foreground">Activity Timeline</p>
              <p className="text-xs text-muted-foreground">
                {activities.length} event{activities.length !== 1 ? "s" : ""}
              </p>
            </div>

            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Clock className="size-8 text-muted-foreground/30" strokeWidth={1.5} />
                <p className="mt-3 text-sm text-muted-foreground">No activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Stage changes, calls, and messages will appear here.
                </p>
              </div>
            ) : (
              <div className="relative px-5 py-4">
                {/* Timeline line */}
                <div className="absolute left-[2.125rem] top-4 bottom-4 w-px bg-border/40" />

                <div className="space-y-4">
                  {activities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-4">
                      {/* Icon bubble */}
                      <div className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background">
                        <ActivityIcon type={activity.type} channel={activity.channel} />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-medium capitalize text-foreground">
                            {activity.type.replace(/_/g, " ")}
                            {activity.channel && activity.channel !== "system" && (
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                via {activity.channel}
                              </span>
                            )}
                            {activity.direction && (
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                ({activity.direction})
                              </span>
                            )}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground/60">
                            {timeAgo(activity.created_at)}
                          </span>
                        </div>
                        {activity.content && (
                          <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                            {activity.content}
                          </p>
                        )}
                        {activity.outcome && (
                          <Badge className="mt-1.5 border-0 bg-foreground/[0.05] text-[10px] uppercase tracking-wider text-muted-foreground">
                            {activity.outcome.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
