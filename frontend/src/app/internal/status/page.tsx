/**
 * /internal/status — Live internal system-status dashboard.
 *
 * Auto-checks Supabase and the backend API every 30s (client-side, no
 * backend round trip needed for the Supabase check — uses the same
 * @/lib/supabase browser client the rest of the app uses). Checks are
 * grouped by category so new categories (e.g. "Integrations" for
 * WhatsApp/Stripe/Email) can be added later without restructuring.
 *
 * This is a separate, ephemeral, in-browser view — it does NOT write to
 * SYSTEM_STATUS_LOG.md (browser JS can't touch the local filesystem, and
 * logging every 30s poll would flood that file). For a persistent,
 * on-demand record, run `npm run check` from the repo root instead; this
 * page and that script check the same two things independently.
 *
 * Not auth-gated — internal/dev use only, shows no tenant data, just
 * up/down + latency. Gate behind auth before this is ever public.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckState = "checking" | "up" | "down";

interface CheckResult {
  up: boolean;
  ms: number;
  detail: string | null;
}

interface CheckStatus extends CheckResult {
  status: CheckState;
  lastChecked: Date | null;
}

interface CheckDef {
  id: string;
  name: string;
  category: string;
  run: () => Promise<CheckResult>;
}

interface HistoryEntry {
  timestamp: Date;
  overallUp: boolean;
  results: Record<string, CheckResult>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const AUTO_REFRESH_MS = 30_000;
const MAX_HISTORY = 30;

async function checkSupabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.from("tenants").select("id").limit(1);
    const ms = Date.now() - start;
    return error ? { up: false, ms, detail: error.message } : { up: true, ms, detail: null };
  } catch (err) {
    return { up: false, ms: Date.now() - start, detail: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function checkBackend(): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
    const ms = Date.now() - start;
    return res.ok ? { up: true, ms, detail: null } : { up: false, ms, detail: `HTTP ${res.status}` };
  } catch (err) {
    const ms = Date.now() - start;
    const detail = err instanceof Error && err.name === "AbortError" ? "timed out after 3s" : err instanceof Error ? err.message : "Unknown error";
    return { up: false, ms, detail };
  } finally {
    clearTimeout(timeout);
  }
}

const CHECKS: CheckDef[] = [
  { id: "supabase", name: "Database (Supabase)", category: "Infrastructure", run: checkSupabase },
  { id: "backend", name: "Backend API", category: "Infrastructure", run: checkBackend },
];

const CATEGORIES = Array.from(new Set(CHECKS.map((c) => c.category)));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: CheckState }) {
  if (status === "checking") return <Loader2 className="size-5 animate-spin text-zinc-500" />;
  if (status === "up") return <CheckCircle2 className="size-5 text-emerald-400" />;
  return <XCircle className="size-5 text-red-400" />;
}

function CheckCard({ name, status }: { name: string; status: CheckStatus }) {
  const borderColour =
    status.status === "up" ? "border-emerald-500/30" : status.status === "down" ? "border-red-500/30" : "border-zinc-800";

  return (
    <div className={`rounded-xl border bg-zinc-900 p-4 ${borderColour}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusIcon status={status.status} />
          <span className="text-sm font-medium text-zinc-100">{name}</span>
        </div>
        {status.status !== "checking" && (
          <span className="text-xs text-zinc-500">{status.ms}ms</span>
        )}
      </div>
      {status.detail && (
        <p className="mt-2 text-xs text-red-400/90 break-words">{status.detail}</p>
      )}
      <p className="mt-2 text-xs text-zinc-600">checked {relativeTime(status.lastChecked)}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InternalStatusPage() {
  const [statuses, setStatuses] = useState<Record<string, CheckStatus>>(() =>
    Object.fromEntries(CHECKS.map((c) => [c.id, { status: "checking", up: false, ms: 0, detail: null, lastChecked: null }]))
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(AUTO_REFRESH_MS / 1000);
  const runningRef = useRef(false);

  const runAll = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatuses((prev) => {
      const next = { ...prev };
      for (const c of CHECKS) next[c.id] = { ...next[c.id], status: "checking" };
      return next;
    });

    const results = await Promise.all(CHECKS.map(async (c) => [c.id, await c.run()] as const));
    const now = new Date();
    const resultMap = Object.fromEntries(results) as Record<string, CheckResult>;

    setStatuses((prev) => {
      const next = { ...prev };
      for (const [id, result] of results) {
        next[id] = { ...result, status: result.up ? "up" : "down", lastChecked: now };
      }
      return next;
    });

    setHistory((prev) => [
      { timestamp: now, overallUp: results.every(([, r]) => r.up), results: resultMap },
      ...prev,
    ].slice(0, MAX_HISTORY));

    setSecondsUntilRefresh(AUTO_REFRESH_MS / 1000);
    runningRef.current = false;
  }, []);

  useEffect(() => {
    runAll();
    const interval = setInterval(runAll, AUTO_REFRESH_MS);
    const countdown = setInterval(() => setSecondsUntilRefresh((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(countdown);
    };
  }, [runAll]);

  const allUp = CHECKS.every((c) => statuses[c.id]?.status === "up");
  const anyChecking = CHECKS.some((c) => statuses[c.id]?.status === "checking");
  const overallLabel = anyChecking ? "Checking…" : allUp ? "All systems up" : "Degraded";
  const overallColour = anyChecking
    ? "bg-zinc-800 text-zinc-300 border-zinc-700"
    : allUp
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : "bg-red-500/10 text-red-400 border-red-500/30";

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">System Status</h1>
            <p className="text-sm text-zinc-500">Internal dashboard — live checks every 30s</p>
          </div>
          <button
            onClick={runAll}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <RefreshCw className="size-3.5" />
            Check now
          </button>
        </div>

        <div className={`mb-8 flex items-center justify-between rounded-xl border px-4 py-3 ${overallColour}`}>
          <span className="text-sm font-semibold">{overallLabel}</span>
          <span className="text-xs opacity-80">next auto-check in {secondsUntilRefresh}s</span>
        </div>

        {CATEGORIES.map((category) => (
          <div key={category} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{category}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHECKS.filter((c) => c.category === category).map((c) => (
                <CheckCard key={c.id} name={c.name} status={statuses[c.id]} />
              ))}
            </div>
          </div>
        ))}

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            This session ({history.length})
          </h2>
          <p className="mb-3 text-xs text-zinc-600">
            Resets on reload — not persisted. For a permanent record, run{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5">npm run check</code> (see SYSTEM_STATUS_LOG.md).
          </p>
          <div className="divide-y divide-zinc-900 rounded-xl border border-zinc-800">
            {history.length === 0 && (
              <p className="px-4 py-3 text-xs text-zinc-600">No checks run yet.</p>
            )}
            {history.map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-zinc-500">{entry.timestamp.toLocaleTimeString()}</span>
                <div className="flex items-center gap-3">
                  {CHECKS.map((c) => (
                    <span key={c.id} title={c.name} className="flex items-center gap-1 text-xs text-zinc-500">
                      <span className={`inline-block size-1.5 rounded-full ${entry.results[c.id]?.up ? "bg-emerald-400" : "bg-red-400"}`} />
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
