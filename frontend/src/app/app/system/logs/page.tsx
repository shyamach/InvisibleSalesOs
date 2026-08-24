'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

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

const LIMIT = 50;

export default function SystemLogsPage() {
  const { getAuthHeaders } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (category) params.set('category', category);
      if (severity) params.set('severity', severity);
      const res = await fetch(`/api/system/logs?${params}`, { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setLogs(json.logs || []);
        setTotal(json.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, offset, category, severity]);

  useEffect(() => { refresh(); }, [refresh]);

  // Filter changes reset pagination.
  const setCategoryAndReset = (c: string) => { setCategory(c); setOffset(0); };
  const setSeverityAndReset = (s: string) => { setSeverity(s); setOffset(0); };

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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>All system logs</h1>
        <p style={{ fontSize: 13, color: COLORS.muted }}>{total} event{total !== 1 ? 's' : ''} total</p>
      </div>

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
        ) : logs.length === 0 ? (
          <p style={{ padding: 40, textAlign: 'center', color: COLORS.muted }}>No log entries match this filter.</p>
        ) : (
          logs.map((log) => {
            const sev = SEVERITY_STYLE[log.severity] || SEVERITY_STYLE.info;
            const isOpen = expanded === log.id;
            return (
              <div key={log.id} style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : log.id)}
                  className="flex w-full items-start gap-3 text-left"
                  style={{ padding: '12px 16px', background: 'transparent', cursor: log.detail ? 'pointer' : 'default' }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: sev.fg, background: sev.bg, padding: '2px 8px', borderRadius: 6, flexShrink: 0, marginTop: 1 }}>
                    {log.severity.toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, textTransform: 'capitalize' }}>
                        {log.category.replace('_', ' ')}
                      </span>
                      <span style={{ fontSize: 11, color: COLORS.mutedLight }}>
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: COLORS.text, marginTop: 2, wordBreak: 'break-word' }}>{log.message}</p>
                    {log.source && <p style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 2, fontFamily: 'monospace' }}>{log.source}</p>}
                  </div>
                </button>
                {isOpen && log.detail && (
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
