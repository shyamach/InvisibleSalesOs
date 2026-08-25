'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Activity, MessageCircle, Mail, Sparkles, Clock, Newspaper,
} from 'lucide-react';

type Severity = 'error' | 'warning' | 'info';

type LogRow = {
  id: string;
  category: string;
  severity: Severity;
  message: string;
  detail: Record<string, unknown> | null;
  source: string | null;
  created_at: string;
};

type CategoryCounts = { error: number; warning: number; info: number };

const COLORS = {
  text: '#2a1f17',
  muted: '#8a7060',
  mutedLight: '#a08c78',
  accent: '#c87941',
  card: '#fffdf9',
  border: '#ece3d4',
  borderLight: '#f0e9dc',
  error: '#c0392b',
  errorBg: '#fdecea',
  warn: '#c87941',
  warnBg: '#fdf3e7',
  info: '#185FA5',
  infoBg: '#e6f0fb',
};

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string }> = {
  error: { bg: COLORS.errorBg, fg: COLORS.error },
  warning: { bg: COLORS.warnBg, fg: COLORS.warn },
  info: { bg: COLORS.infoBg, fg: COLORS.info },
};

const CATEGORIES = ['system', 'whatsapp', 'imap', 'claude', 'auto_reply', 'follow_up', 'digest', 'webhook'];

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
  return CATEGORY_META[cat] || { label: cat.replace('_', ' '), Icon: Activity };
}

const LIMIT = 50;
const CLUSTER_PREVIEW_LIMIT = 8;
const ERRORS_PANEL_LIMIT = 20;
const AUTO_REFRESH_MS = 30_000;

export default function SystemLogsPage() {
  const { getAuthHeaders } = useAuth();
  const [viewMode, setViewMode] = useState<'clusters' | 'list'>('clusters');

  // ── Full list (existing, unchanged behaviour) ──────────────────────────
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Previously silently did nothing on a non-success response (network
  // error, or a 403 from requireAdmin for anyone who isn't the platform
  // operator) — `logs` just stayed at its initial empty array, which the UI
  // below rendered as "No log entries match this filter.", indistinguishable
  // from a genuinely quiet system. Found live 2026-08-25 QA pass: this
  // tenant's own owner account gets a real 403 here (this page is
  // platform-admin-only) and the page showed a falsely reassuring empty
  // state instead of an access-denied message.
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (category) params.set('category', category);
      if (severity) params.set('severity', severity);
      const res = await fetch(`/api/system/logs?${params}`, { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setLogs(json.logs || []);
        setTotal(json.total || 0);
      } else {
        setLoadError(res.status === 403 ? "You don't have access to system logs." : (json.error || 'Failed to load logs.'));
      }
    } catch {
      setLoadError('Failed to load logs.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, offset, category, severity]);

  useEffect(() => { if (viewMode === 'list') refresh(); }, [viewMode, refresh]);

  const setCategoryAndReset = (c: string) => { setCategory(c); setOffset(0); };
  const setSeverityAndReset = (s: string) => { setSeverity(s); setOffset(0); };

  // ── Clustered live view ─────────────────────────────────────────────────
  const [byCategory, setByCategory] = useState<Record<string, CategoryCounts>>({});
  const [clusterLoading, setClusterLoading] = useState(true);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [clusterLogs, setClusterLogs] = useState<Record<string, LogRow[]>>({});
  const [errorLogs, setErrorLogs] = useState<LogRow[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [clusterLoadError, setClusterLoadError] = useState<string | null>(null);

  // Same bug as `refresh` above, on the default cluster view — a 403 (or any
  // other failure) from either call left byCategory/errorLogs at their
  // initial empty state, rendering as "No errors — all clear." and "No
  // events logged in the last 24h." instead of an honest access-denied
  // message.
  const refreshClusters = useCallback(async () => {
    try {
      const [healthRes, errorsRes] = await Promise.all([
        fetch('/api/system/health?window_hours=24', { headers: getAuthHeaders() }),
        fetch(`/api/system/logs?severity=error&limit=${ERRORS_PANEL_LIMIT}`, { headers: getAuthHeaders() }),
      ]);
      const health = await healthRes.json();
      const errors = await errorsRes.json();
      if (health.success) {
        setByCategory(health.by_category || {});
        setClusterLoadError(null);
      } else {
        setClusterLoadError(healthRes.status === 403 ? "You don't have access to system health." : (health.error || 'Failed to load system health.'));
      }
      if (errors.success) setErrorLogs(errors.logs || []);
      setLastRefreshed(new Date());
    } catch {
      setClusterLoadError('Failed to load system health.');
    } finally {
      setClusterLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (viewMode !== 'clusters') return;
    refreshClusters();
    const t = setInterval(refreshClusters, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [viewMode, refreshClusters]);

  const toggleCluster = useCallback(async (cat: string) => {
    if (openCluster === cat) {
      setOpenCluster(null);
      return;
    }
    setOpenCluster(cat);
    if (!clusterLogs[cat]) {
      const res = await fetch(`/api/system/logs?category=${cat}&limit=${CLUSTER_PREVIEW_LIMIT}`, { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) setClusterLogs((prev) => ({ ...prev, [cat]: json.logs || [] }));
    }
  }, [openCluster, clusterLogs, getAuthHeaders]);

  const categoriesWithData = CATEGORIES.filter((c) => {
    const counts = byCategory[c];
    return counts && counts.error + counts.warning + counts.info > 0;
  }).sort((a, b) => {
    const ca = byCategory[a], cb = byCategory[b];
    return (cb.error + cb.warning) - (ca.error + ca.warning);
  });

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>
      {/* Header */}
      <Link
        href="/app/system"
        className="flex items-center gap-1.5 transition-colors"
        style={{ fontSize: 12, color: COLORS.muted, marginBottom: 16 }}
      >
        <ArrowLeft className="size-3.5" /> Back to system health
      </Link>
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>System logs</h1>
          <p style={{ fontSize: 13, color: COLORS.muted }}>
            {viewMode === 'clusters'
              ? lastRefreshed ? `Live — updated ${lastRefreshed.toLocaleTimeString()}` : 'Live'
              : `${total} event${total !== 1 ? 's' : ''} total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilterButton active={viewMode === 'clusters'} onClick={() => setViewMode('clusters')}>Clusters</FilterButton>
          <FilterButton active={viewMode === 'list'} onClick={() => setViewMode('list')}>Full list</FilterButton>
        </div>
      </div>

      {viewMode === 'clusters' ? (
        <>
          {/* Live errors panel — always visible regardless of which cluster is open */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.error}`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: COLORS.error, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Live errors ({errorLogs.length})
            </p>
            {clusterLoading && errorLogs.length === 0 ? (
              <p style={{ fontSize: 13, color: COLORS.muted, padding: '4px 0' }}>Loading…</p>
            ) : clusterLoadError ? (
              <p style={{ fontSize: 13, color: COLORS.error, padding: '4px 0' }}>{clusterLoadError}</p>
            ) : errorLogs.length === 0 ? (
              <p style={{ fontSize: 13, color: COLORS.muted, padding: '4px 0' }}>No errors — all clear.</p>
            ) : (
              <div className="flex flex-col">
                {errorLogs.map((log) => <LogEntryRow key={log.id} log={log} />)}
              </div>
            )}
          </div>

          {/* Category clusters */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {clusterLoading && categoriesWithData.length === 0 ? (
              <p style={{ fontSize: 13, color: COLORS.muted, padding: '20px 4px' }}>Loading clusters…</p>
            ) : clusterLoadError ? (
              <p style={{ fontSize: 13, color: COLORS.error, padding: '20px 4px' }}>{clusterLoadError}</p>
            ) : categoriesWithData.length === 0 ? (
              <p style={{ fontSize: 13, color: COLORS.muted, padding: '20px 4px' }}>No events logged in the last 24h.</p>
            ) : (
              categoriesWithData.map((cat) => {
                const meta = categoryMeta(cat);
                const counts = byCategory[cat];
                const isOpen = openCluster === cat;
                return (
                  <div key={cat} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <button
                      onClick={() => toggleCluster(cat)}
                      className="flex w-full items-center gap-2 text-left"
                      style={{ padding: '12px 14px' }}
                    >
                      <meta.Icon className="size-4 shrink-0" style={{ color: COLORS.mutedLight }} strokeWidth={1.6} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, flex: 1 }}>{meta.label}</span>
                      {counts.error > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.error, background: COLORS.errorBg, padding: '2px 7px', borderRadius: 6 }}>
                          {counts.error} err
                        </span>
                      )}
                      {counts.warning > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.warn, background: COLORS.warnBg, padding: '2px 7px', borderRadius: 6 }}>
                          {counts.warning} warn
                        </span>
                      )}
                      {counts.info > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.info, background: COLORS.infoBg, padding: '2px 7px', borderRadius: 6 }}>
                          {counts.info} info
                        </span>
                      )}
                      {isOpen ? <ChevronUp className="size-3.5 shrink-0" style={{ color: COLORS.mutedLight }} /> : <ChevronDown className="size-3.5 shrink-0" style={{ color: COLORS.mutedLight }} />}
                    </button>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                        {!clusterLogs[cat] ? (
                          <p style={{ padding: 16, fontSize: 12, color: COLORS.muted }}>Loading…</p>
                        ) : clusterLogs[cat].length === 0 ? (
                          <p style={{ padding: 16, fontSize: 12, color: COLORS.muted }}>No recent entries.</p>
                        ) : (
                          <>
                            {clusterLogs[cat].map((log) => <LogEntryRow key={log.id} log={log} compact />)}
                            <Link
                              href="#"
                              onClick={(e) => { e.preventDefault(); setViewMode('list'); setCategoryAndReset(cat); }}
                              className="flex items-center justify-center"
                              style={{ padding: '8px', fontSize: 11, fontWeight: 600, color: COLORS.accent, borderTop: `1px solid ${COLORS.borderLight}` }}
                            >
                              View all {meta.label} logs →
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: COLORS.mutedLight, marginRight: 4 }}>CATEGORY</span>
            <FilterButton active={category === ''} onClick={() => setCategoryAndReset('')}>All</FilterButton>
            {CATEGORIES.map((c) => (
              <FilterButton key={c} active={category === c} onClick={() => setCategoryAndReset(c)}>
                {c.replace('_', ' ')}
              </FilterButton>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 20 }}>
            <span style={{ fontSize: 11, color: COLORS.mutedLight, marginRight: 4 }}>SEVERITY</span>
            <FilterButton active={severity === ''} onClick={() => setSeverityAndReset('')}>All</FilterButton>
            <FilterButton active={severity === 'error'} onClick={() => setSeverityAndReset('error')}>Error</FilterButton>
            <FilterButton active={severity === 'warning'} onClick={() => setSeverityAndReset('warning')}>Warning</FilterButton>
            <FilterButton active={severity === 'info'} onClick={() => setSeverityAndReset('info')}>Info</FilterButton>
          </div>

          {/* Table */}
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {loading && logs.length === 0 ? (
              <p style={{ padding: 32, textAlign: 'center', color: COLORS.muted }}>Loading…</p>
            ) : loadError ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <p style={{ color: COLORS.error, fontSize: 13, marginBottom: 10 }}>{loadError}</p>
                <button onClick={() => refresh()} style={{ padding: '8px 16px', borderRadius: 8, background: COLORS.warnBg, color: COLORS.accent, border: `1px solid ${COLORS.border}`, fontSize: 13, fontWeight: 600 }}>
                  Retry
                </button>
              </div>
            ) : logs.length === 0 ? (
              <p style={{ padding: 40, textAlign: 'center', color: COLORS.muted }}>No log entries match this filter.</p>
            ) : (
              logs.map((log) => {
                const isOpen = expanded === log.id;
                return (
                  <div key={log.id} style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                    <LogEntryRow log={log} onToggle={() => setExpanded(isOpen ? null : log.id)} showDetail={isOpen} />
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between" style={{ marginTop: 14 }}>
              <span style={{ fontSize: 12, color: COLORS.muted }}>
                {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                  className="flex items-center gap-1"
                  style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1px solid ${COLORS.border}`, background: COLORS.card, color: COLORS.muted, opacity: offset === 0 ? 0.4 : 1 }}
                >
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={offset + LIMIT >= total}
                  className="flex items-center gap-1"
                  style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1px solid ${COLORS.border}`, background: COLORS.card, color: COLORS.muted, opacity: offset + LIMIT >= total ? 0.4 : 1 }}
                >
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LogEntryRow({ log, compact = false, onToggle, showDetail }: { log: LogRow; compact?: boolean; onToggle?: () => void; showDetail?: boolean }) {
  const sev = SEVERITY_STYLE[log.severity] || SEVERITY_STYLE.info;
  const meta = categoryMeta(log.category);
  const clickable = Boolean(onToggle) && Boolean(log.detail);
  return (
    <div style={compact ? { borderTop: `1px solid ${COLORS.borderLight}` } : undefined}>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        style={{ padding: compact ? '8px 14px' : '12px 16px', background: 'transparent', cursor: clickable ? 'pointer' : 'default' }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: sev.fg, background: sev.bg, padding: '2px 8px', borderRadius: 6, flexShrink: 0, marginTop: 1 }}>
          {log.severity.toUpperCase()}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-center gap-2">
            {!compact && (
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, textTransform: 'capitalize' }}>
                {meta.label}
              </span>
            )}
            <span style={{ fontSize: 11, color: COLORS.mutedLight }}>
              {new Date(log.created_at).toLocaleString()}
            </span>
          </div>
          <p style={{ fontSize: compact ? 12 : 13, color: COLORS.text, marginTop: 2, wordBreak: 'break-word' }}>{log.message}</p>
          {!compact && log.source && <p style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 2, fontFamily: 'monospace' }}>{log.source}</p>}
        </div>
      </button>
      {showDetail && log.detail && (
        <pre
          style={{
            margin: '0 16px 12px 16px', padding: '10px 12px', background: '#faf6ef',
            borderRadius: 8, fontSize: 11, color: COLORS.muted, overflowX: 'auto',
            fontFamily: 'monospace',
          }}
        >
          {JSON.stringify(log.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
        border: '1px solid ' + (active ? COLORS.accent : COLORS.border),
        background: active ? 'rgba(200,121,65,0.1)' : COLORS.card,
        color: active ? COLORS.accent : COLORS.muted,
      }}
    >
      {children}
    </button>
  );
}
