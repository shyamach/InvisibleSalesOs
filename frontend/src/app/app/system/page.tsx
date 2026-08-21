'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Mail,
  Sparkles,
  Clock,
  Newspaper,
  ArrowRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type OverallStatus = 'healthy' | 'degraded' | 'blocked';
type Severity = 'error' | 'warning' | 'info';

type Blocker = { category: string; message: string; severity: Severity };

type CategoryCounts = { error: number; warning: number; info: number };

type LiveSubsystem = Record<string, unknown>;

type HealthSummary = {
  success: boolean;
  timestamp: string;
  window_hours: number;
  overall_status: OverallStatus;
  totals: { errors: number; warnings: number; events: number };
  by_category: Record<string, CategoryCounts>;
  blockers: Blocker[];
  live: {
    whatsapp: { status: string };
    claude: { state: string; consecutiveFailures: number; lastError: string | null };
    imap: { enabled: boolean; lastErrorClass: string | null; lastError: string | null; consecutiveFailures: number; lastSuccessAt: string | null };
    autoReplySweeper: { at: string | null; summary: LiveSubsystem | null };
    followUpEngine: { at: string | null; summary: LiveSubsystem | null };
    digestScheduler: { at: string | null; summary: LiveSubsystem | null };
  };
};

// ─── Style tokens (matches escalations/quotes pages) ───────────────────────

const COLORS = {
  text: '#2a1f17',
  muted: '#8a7060',
  mutedLight: '#a08c78',
  accent: '#c87941',
  card: '#fffdf9',
  border: '#ece3d4',
  borderLight: '#f0e9dc',
  ok: '#4a7c59',
  okBg: '#eef7f1',
  warn: '#c87941',
  warnBg: '#fdf3e7',
  error: '#c0392b',
  errorBg: '#fdecea',
};

const STATUS_STYLE: Record<OverallStatus, { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 }> = {
  healthy: { bg: COLORS.okBg, fg: COLORS.ok, label: 'All systems healthy', Icon: CheckCircle2 },
  degraded: { bg: COLORS.warnBg, fg: COLORS.warn, label: 'Degraded — non-blocking issues', Icon: AlertTriangle },
  blocked: { bg: COLORS.errorBg, fg: COLORS.error, label: 'Blocked — needs attention', Icon: XCircle },
};

const CATEGORY_META: Record<string, { label: string; Icon: typeof Activity }> = {
  system: { label: 'System', Icon: Activity },
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle },
  imap: { label: 'Email (IMAP)', Icon: Mail },
  claude: { label: 'Claude API', Icon: Sparkles },
  auto_reply: { label: 'Auto-reply', Icon: Clock },
  follow_up: { label: 'Follow-up', Icon: Clock },
  digest: { label: 'Digest', Icon: Newspaper },
  webhook: { label: 'Webhooks', Icon: Activity },
};

function categoryMeta(cat: string) {
  return CATEGORY_META[cat] || { label: cat, Icon: Activity };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dotColor(ok: boolean) {
  return ok ? COLORS.ok : COLORS.error;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SystemHealthPage() {
  const { getAuthHeaders } = useAuth();
  const [data, setData] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState(24);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/system/health?window_hours=${windowHours}`, { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) setData(json);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, windowHours]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30s — this is a "is everything OK right now" page.
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const status = data ? STATUS_STYLE[data.overall_status] : null;

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,121,65,0.12)', width: 40, height: 40 }}>
            <Activity className="size-5" style={{ color: COLORS.accent }} strokeWidth={1.6} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>System health</h1>
            <p style={{ fontSize: 13, color: COLORS.muted }}>Live status, categorized errors, and blockers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[24, 24 * 7, 24 * 30].map((h) => (
            <button
              key={h}
              onClick={() => setWindowHours(h)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: '1px solid ' + (windowHours === h ? COLORS.accent : COLORS.border),
                background: windowHours === h ? 'rgba(200,121,65,0.1)' : COLORS.card,
                color: windowHours === h ? COLORS.accent : COLORS.muted,
              }}
            >
              {h === 24 ? '24h' : h === 24 * 7 ? '7d' : '30d'}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <p style={{ padding: 32, textAlign: 'center', color: COLORS.muted }}>Loading…</p>
      ) : !data ? (
        <p style={{ padding: 32, textAlign: 'center', color: COLORS.error }}>Failed to load system health.</p>
      ) : (
        <>
          {/* Overall status banner */}
          {status && (
            <div
              className="flex items-center gap-3"
              style={{ background: status.bg, borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}
            >
              <status.Icon className="size-5 shrink-0" style={{ color: status.fg }} strokeWidth={1.8} />
              <span style={{ fontSize: 15, fontWeight: 700, color: status.fg }}>{status.label}</span>
              <span style={{ fontSize: 12, color: status.fg, opacity: 0.75, marginLeft: 'auto' }}>
                Updated {new Date(data.timestamp).toLocaleTimeString()}
              </span>
            </div>
          )}

          {/* Blockers — only rendered when non-empty, most important thing on the page */}
          {data.blockers.length > 0 && (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.error}`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: COLORS.error, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Blockers ({data.blockers.length})
              </p>
              <div className="flex flex-col gap-2">
                {data.blockers.map((b, i) => {
                  const meta = categoryMeta(b.category);
                  return (
                    <div key={i} className="flex items-start gap-2" style={{ padding: '8px 10px', background: b.severity === 'error' ? COLORS.errorBg : COLORS.warnBg, borderRadius: 8 }}>
                      <meta.Icon className="size-4 shrink-0 mt-0.5" style={{ color: b.severity === 'error' ? COLORS.error : COLORS.warn }} strokeWidth={1.8} />
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>{meta.label}</span>
                        <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 1 }}>{b.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 20 }}>
            {[
              { label: 'Errors', value: data.totals.errors, color: data.totals.errors > 0 ? COLORS.error : COLORS.text },
              { label: 'Warnings', value: data.totals.warnings, color: data.totals.warnings > 0 ? COLORS.warn : COLORS.text },
              { label: 'Total events', value: data.totals.events, color: COLORS.text },
            ].map((c) => (
              <div key={c.label} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.muted }}>{c.label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Live subsystem status */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Live subsystem status
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              <SubsystemTile
                label="WhatsApp"
                Icon={MessageCircle}
                ok={data.live.whatsapp.status === 'connected'}
                detail={data.live.whatsapp.status}
              />
              <SubsystemTile
                label="Claude API"
                Icon={Sparkles}
                ok={data.live.claude.state === 'closed'}
                detail={data.live.claude.state === 'closed' ? 'Operating normally' : `${data.live.claude.state} — ${data.live.claude.consecutiveFailures} consecutive failures`}
              />
              <SubsystemTile
                label="Email (IMAP)"
                Icon={Mail}
                ok={!data.live.imap.enabled || !data.live.imap.lastErrorClass}
                detail={!data.live.imap.enabled ? 'Disabled' : data.live.imap.lastErrorClass ? `${data.live.imap.lastErrorClass} error` : `Last success ${timeAgo(data.live.imap.lastSuccessAt)}`}
              />
              <SubsystemTile
                label="Auto-reply sweeper"
                Icon={Clock}
                ok={!(data.live.autoReplySweeper.summary as { error?: string } | null)?.error}
                detail={`Last run ${timeAgo(data.live.autoReplySweeper.at)}`}
              />
              <SubsystemTile
                label="Follow-up engine"
                Icon={Clock}
                ok={!(data.live.followUpEngine.summary as { error?: string } | null)?.error}
                detail={`Last run ${timeAgo(data.live.followUpEngine.at)}`}
              />
              <SubsystemTile
                label="Digest scheduler"
                Icon={Newspaper}
                ok={!(data.live.digestScheduler.summary as { error?: string } | null)?.error}
                detail={`Last run ${timeAgo(data.live.digestScheduler.at)}`}
              />
            </div>
          </div>

          {/* Category breakdown */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Errors by category ({data.window_hours === 24 ? 'last 24h' : data.window_hours === 168 ? 'last 7d' : 'last 30d'})
              </p>
              <Link
                href="/app/system/logs"
                className="flex items-center gap-1 transition-colors"
                style={{ fontSize: 12, fontWeight: 600, color: COLORS.accent }}
              >
                View all logs <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="flex flex-col gap-1.5">
              {Object.entries(data.by_category)
                .filter(([, c]) => c.error + c.warning + c.info > 0)
                .sort(([, a], [, b]) => (b.error + b.warning) - (a.error + a.warning))
                .map(([cat, counts]) => {
                  const meta = categoryMeta(cat);
                  return (
                    <div key={cat} className="flex items-center gap-3" style={{ padding: '7px 4px' }}>
                      <meta.Icon className="size-4 shrink-0" style={{ color: COLORS.mutedLight }} strokeWidth={1.6} />
                      <span style={{ fontSize: 13, color: COLORS.text, flex: 1 }}>{meta.label}</span>
                      {counts.error > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.error, background: COLORS.errorBg, padding: '2px 8px', borderRadius: 6 }}>
                          {counts.error} error{counts.error !== 1 ? 's' : ''}
                        </span>
                      )}
                      {counts.warning > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.warn, background: COLORS.warnBg, padding: '2px 8px', borderRadius: 6 }}>
                          {counts.warning} warning{counts.warning !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              {Object.values(data.by_category).every((c) => c.error + c.warning + c.info === 0) && (
                <p style={{ fontSize: 13, color: COLORS.muted, padding: '8px 4px' }}>No events logged in this window.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SubsystemTile({ label, Icon, ok, detail }: { label: string; Icon: typeof Activity; ok: boolean; detail: string }) {
  return (
    <div style={{ border: `1px solid ${COLORS.borderLight}`, borderRadius: 8, padding: '10px 12px' }}>
      <div className="flex items-center gap-2">
        <span className="inline-block rounded-full shrink-0" style={{ width: 7, height: 7, background: dotColor(ok) }} />
        <Icon className="size-3.5 shrink-0" style={{ color: COLORS.mutedLight }} strokeWidth={1.6} />
        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{label}</span>
      </div>
      <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{detail}</p>
    </div>
  );
}
