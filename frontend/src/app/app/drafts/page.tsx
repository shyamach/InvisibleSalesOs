"use client";

/**
 * Drafts — Approval UI.
 * The core human-in-the-loop workflow:
 * Every AI-generated reply lands here for one-tap approve / edit / escalate / dismiss.
 * Real-time: subscribes to smart_interactions via Supabase Realtime.
 * Design: Direction C — Warm & Trustworthy
 */

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { useAuth } from "@/components/AuthProvider";
import {
  Check,
  CheckCircle,
  Clock,
  Edit2,
  Mail,
  MessageSquare,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Draft {
  id: string;
  message_content: string;
  created_at: string;
  lead_id: string;
  customer_name: string | null;
  company_name: string | null;
  product_interest: string | null;
  ptc_score: number | null;
  intent_category: string | null;
  source_channel: string | null;
}

// ─── Supabase client (client-side) ───────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPriorityLabel(score: number | null, category: string | null): "HIGH" | "MEDIUM" | "LOW" {
  if (category === "HIGH" || category === "MEDIUM" || category === "LOW") return category;
  if (!score) return "LOW";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DraftsPage() {
  const { getAuthHeaders } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch drafts ──────────────────────────────────────────────────────────

  const fetchDrafts = useCallback(async () => {
    const { data, error } = await supabase
      .from("smart_interactions")
      .select(`
        id, message_content, created_at, lead_id,
        smart_leads (
          customer_name, company_name, product_interest,
          ptc_score, intent_category, source_channel
        )
      `)
      .eq("direction", "outbound_draft")
      .order("created_at", { ascending: false });

    if (error) {
      showToast("error", "Failed to load drafts");
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat: Draft[] = (data ?? []).map((row: any) => ({
      id: row.id,
      message_content: row.message_content,
      created_at: row.created_at,
      lead_id: row.lead_id,
      customer_name: row.smart_leads?.customer_name ?? null,
      company_name: row.smart_leads?.company_name ?? null,
      product_interest: row.smart_leads?.product_interest ?? null,
      ptc_score: row.smart_leads?.ptc_score ?? null,
      intent_category: row.smart_leads?.intent_category ?? null,
      source_channel: row.smart_leads?.source_channel ?? null,
    }));

    setDrafts(flat);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDrafts();

    const channel = supabase
      .channel("drafts-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "smart_interactions" }, fetchDrafts)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchDrafts]);

  // ── Optimistic remove ─────────────────────────────────────────────────────

  const removeDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleApprove = async (draft: Draft) => {
    setActionLoading(draft.id);
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ interaction_id: draft.id }),
      });
      const json = await res.json();
      if (json.success) {
        removeDraft(draft.id);
        showToast("success", `Message sent to ${draft.customer_name ?? "prospect"}`);
      } else {
        showToast("error", json.error ?? "Dispatch failed — is the backend running?");
      }
    } catch {
      showToast("error", "Network error — backend may be offline");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveAndSend = async (draft: Draft) => {
    if (!editText.trim()) return;
    setActionLoading(draft.id);
    try {
      await supabase
        .from("smart_interactions")
        .update({ message_content: editText.trim() })
        .eq("id", draft.id);

      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ interaction_id: draft.id }),
      });
      const json = await res.json();
      if (json.success) {
        setEditingId(null);
        removeDraft(draft.id);
        showToast("success", `Edited message sent to ${draft.customer_name ?? "prospect"}`);
      } else {
        showToast("error", json.error ?? "Send failed");
      }
    } catch {
      showToast("error", "Network error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (draft: Draft) => {
    setActionLoading(draft.id);
    await supabase.from("smart_interactions").update({ direction: "dismissed" }).eq("id", draft.id);
    removeDraft(draft.id);
    setActionLoading(null);
    showToast("success", "Draft dismissed");
  };

  const handleEscalate = async (draft: Draft) => {
    setActionLoading(draft.id);
    await supabase.from("smart_interactions").update({ direction: "escalated" }).eq("id", draft.id);
    await supabase.from("smart_leads").update({ triage_status: "escalated" }).eq("id", draft.lead_id).eq("tenant_id", TENANT_ID);
    removeDraft(draft.id);
    setActionLoading(null);
    showToast("success", "Escalated to sales rep");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-6" style={{ background: '#faf8f5' }}>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm shadow-lg transition-all"
          style={
            toast.type === "success"
              ? { background: '#eef7f1', color: '#4a7c59', border: '1px solid #c8e6c9' }
              : { background: '#fdecea', color: '#c0392b', border: '1px solid #f5c6cb' }
          }
        >
          {toast.type === "success"
            ? <CheckCircle className="size-4" strokeWidth={1.5} />
            : <X className="size-4" strokeWidth={1.5} />}
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold" style={{ color: '#1c1612' }}>Drafts</h1>
            {drafts.length > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ background: '#fdf0e8', color: '#9b5e3c' }}
              >
                {drafts.length}
              </span>
            )}
          </div>
          <p className="text-sm mt-0.5" style={{ color: '#7a6a5a' }}>
            AI-generated replies waiting for your approval
          </p>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center gap-3 mb-5 text-[10px] uppercase tracking-[0.14em]" style={{ color: '#b8a898' }}>
        {[["A", "approve"], ["E", "edit"], ["S", "escalate"], ["D", "dismiss"]].map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <kbd
              className="rounded px-1.5 py-0.5 font-mono text-[10px]"
              style={{ border: '1px solid #ede5d8', background: '#ffffff', color: '#7a6a5a' }}
            >
              {key}
            </kbd>
            {label}
          </span>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-sm" style={{ color: '#b8a898' }}>
          Loading drafts...
        </div>
      )}

      {/* Empty state */}
      {!loading && drafts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="size-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#fdf3e7' }}
          >
            <CheckCircle className="size-7" style={{ color: '#c87941' }} strokeWidth={1.5} />
          </div>
          <h3 className="text-base font-semibold mb-1" style={{ color: '#1c1612' }}>All clear</h3>
          <p className="text-sm max-w-xs" style={{ color: '#7a6a5a' }}>
            No drafts awaiting approval. New leads will appear here automatically.
          </p>
        </div>
      )}

      {/* Draft cards */}
      <div className="max-w-3xl mx-auto space-y-3">
        {drafts.map((draft) => {
          const priority = getPriorityLabel(draft.ptc_score, draft.intent_category);
          const isEditing = editingId === draft.id;
          const isActing = actionLoading === draft.id;
          const isEmail = draft.source_channel?.includes("email");

          return (
            <div
              key={draft.id}
              className="bg-white rounded-xl"
              style={{ border: '1px solid #ede5d8' }}
            >
              {/* Card header */}
              <div
                className="flex items-center justify-between p-4"
                style={{ borderBottom: '1px solid #f5ede4' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="size-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                    style={{ background: '#fdf3e7', color: '#c87941' }}
                  >
                    {(draft.customer_name ?? draft.company_name ?? "?")[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#1c1612' }}>
                      {draft.customer_name ?? "Unknown Prospect"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1 text-xs" style={{ color: '#b8a898' }}>
                        <Clock className="size-3" strokeWidth={1.5} />
                        {timeAgo(draft.created_at)}
                      </span>
                      <span className="flex items-center gap-1 text-xs" style={{ color: '#b8a898' }}>
                        {isEmail
                          ? <Mail className="size-3" strokeWidth={1.5} />
                          : <MessageSquare className="size-3" strokeWidth={1.5} />}
                        {isEmail ? "Email" : "WhatsApp"}
                      </span>
                      {draft.company_name && (
                        <span className="text-xs" style={{ color: '#b8a898' }}>
                          · {draft.company_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <PriorityBadge priority={priority} />
              </div>

              {/* Original message context (product interest) */}
              {draft.product_interest && (
                <div
                  className="px-4 py-3"
                  style={{ background: '#faf8f5', borderBottom: '1px solid #f5ede4' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#b8a898' }}>
                    Original message
                  </p>
                  <p className="text-sm" style={{ color: '#7a6a5a' }}>
                    {draft.product_interest}
                  </p>
                </div>
              )}

              {/* AI draft content */}
              <div className="p-4" style={{ borderBottom: '1px solid #f5ede4' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: '#b8a898' }}>
                  <Sparkles className="size-3" style={{ color: '#c87941' }} strokeWidth={1.5} />
                  AI Draft
                </p>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm rounded-lg p-3 focus:outline-none resize-none"
                    style={{ border: '1px solid #ede5d8', color: '#1c1612', background: 'white' }}
                    rows={5}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                    placeholder="Edit the draft message..."
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: '#1c1612' }}>
                    {draft.message_content}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 p-4">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleSaveAndSend(draft)}
                      disabled={isActing || !editText.trim()}
                      className="flex-1 py-2 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
                      style={{ background: '#c87941' }}
                    >
                      <Check className="size-4" strokeWidth={1.5} />
                      {isActing ? "Sending..." : "Save & Send"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={isActing}
                      className="px-4 py-2 rounded-lg text-sm"
                      style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleApprove(draft)}
                      disabled={isActing}
                      className="flex-1 py-2 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
                      style={{ background: '#c87941' }}
                    >
                      <Check className="size-4" strokeWidth={1.5} />
                      {isActing ? "Sending..." : "Approve & send"}
                    </button>
                    <button
                      onClick={() => { setEditingId(draft.id); setEditText(draft.message_content); }}
                      disabled={isActing}
                      className="px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
                      style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
                    >
                      <Edit2 className="size-3.5" strokeWidth={1.5} /> Edit
                    </button>
                    <button
                      onClick={() => handleEscalate(draft)}
                      disabled={isActing}
                      className="px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
                      style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
                    >
                      <UserPlus className="size-3.5" strokeWidth={1.5} /> Escalate
                    </button>
                    <button
                      onClick={() => handleDismiss(draft)}
                      disabled={isActing}
                      className="px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
                      style={{ border: '1px solid #fdecea', color: '#c0392b' }}
                    >
                      <X className="size-3.5" strokeWidth={1.5} /> Dismiss
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
