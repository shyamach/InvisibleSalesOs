'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { LifeBuoy } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

// Realtime subscription only — reads/writes go through the authenticated
// /api/escalations* routes below. See catalogue/page.tsx for the same fix
// applied 2026-08-18 (Phase B item B2).

type Lead = { customer_name: string | null; company_name: string | null; product_interest: string | null };
type Escalation = {
  id: string;
  reason: 'out_of_stock' | 'price_negotiation' | 'manual' | 'other';
  status: 'pending' | 'accepted' | 'converted' | 'rejected' | 'stalled';
  assigned_to_name: string | null;
  trigger_context: string | null;
  note: string | null;
  outcome_note: string | null;
  deal_value: number | null;
  created_at: string;
  smart_leads?: Lead | null;
};
type Attribution = { rep: string; total: number; converted: number; conversion_rate: number; value: number };

const REASON_LABEL: Record<string, string> = {
  out_of_stock: 'Out of stock', price_negotiation: 'Price negotiation', manual: 'Manual', other: 'Other',
};
const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  pending:   { background: '#fdf3e7', color: '#c87941' },
  accepted:  { background: '#e6f0fb', color: '#185FA5' },
  converted: { background: '#eef7f1', color: '#4a7c59' },
  rejected:  { background: '#fdecea', color: '#c0392b' },
  stalled:   { background: '#f5f5f5', color: '#999' },
};
const NEXT_STATUSES: Record<string, string[]> = {
  pending: ['accepted', 'converted', 'rejected', 'stalled'],
  accepted: ['converted', 'rejected', 'stalled'],
  stalled: ['accepted', 'converted', 'rejected'],
  converted: [], rejected: [],
};

function money(n: number) {
  return '£' + Number(n || 0).toFixed(2);
}

export default function EscalationsPage() {
  const { getAuthHeaders } = useAuth();
  const [items, setItems] = useState<Escalation[]>([]);
  const [attribution, setAttribution] = useState<Attribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [loadError, setLoadError] = useState(false);

  // Previously no try/catch — a thrown fetch (network blip, or in dev a Fast
  // Refresh remount racing an in-flight request) skipped setLoading(false)
  // and left the page stuck on "Loading…" forever. See the same fix on
  // frontend/src/app/app/invoices/page.tsx (2026-08-25) for the full story.
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [escRes, attrRes] = await Promise.all([
        fetch(`/api/escalations${filter ? `?status=${filter}` : ''}`, { headers: getAuthHeaders() }),
        fetch('/api/escalations/attribution', { headers: getAuthHeaders() }),
      ]);
      setItems((await escRes.json()).escalations || []);
      setAttribution((await attrRes.json()).attribution || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [filter, getAuthHeaders]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel('escalations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escalations' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/escalations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body),
    });
    refresh();
  };

  const setStatus = (e: Escalation, status: string) => {
    if (status === 'converted') {
      const v = prompt('Deal value won (£):', e.deal_value ? String(e.deal_value) : '');
      patch(e.id, { status, deal_value: v ? parseFloat(v) : undefined });
    } else {
      patch(e.id, { status });
    }
  };

  const pending = items.filter((e) => e.status === 'pending').length;
  const wonValue = attribution.reduce((s, a) => s + a.value, 0);

  const leadName = (e: Escalation) =>
    e.smart_leads?.customer_name || e.smart_leads?.company_name || 'Unknown lead';

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,121,65,0.12)', width: 40, height: 40 }}>
          <LifeBuoy className="size-5" style={{ color: '#c87941' }} strokeWidth={1.6} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2a1f17' }}>Sales-rep handoffs</h1>
          <p style={{ fontSize: 13, color: '#8a7060' }}>Escalated leads & outcome tracking</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 20 }}>
        {[
          { label: 'Open handoffs', value: String(pending) },
          { label: 'Total handoffs', value: String(items.length) },
          { label: 'Won value', value: money(wonValue) },
        ].map((c) => (
          <div key={c.label} style={{ background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8a7060' }}>{c.label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#2a1f17', marginTop: 4 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Attribution */}
      {attribution.length > 0 && (
        <div style={{ background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#7a6a5a', marginBottom: 10 }}>REP ATTRIBUTION</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {attribution.map((a) => (
              <div key={a.rep} style={{ border: '1px solid #f0e9dc', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontWeight: 600, color: '#2a1f17' }}>{a.rep}</div>
                <div style={{ fontSize: 12, color: '#8a7060', marginTop: 2 }}>
                  {a.converted}/{a.total} won · {a.conversion_rate}% · {money(a.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        {['', 'pending', 'accepted', 'converted', 'rejected', 'stalled'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (filter === s ? '#c87941' : '#e4dccd'),
              background: filter === s ? 'rgba(200,121,65,0.1)' : '#fffdf9',
              color: filter === s ? '#c87941' : '#7a6a5a',
            }}
          >
            {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 32, textAlign: 'center', color: '#8a7060' }}>Loading…</p>
        ) : loadError ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>Couldn&apos;t load handoffs</p>
            <button onClick={() => refresh()} style={{ padding: '8px 16px', borderRadius: 8, background: '#fdf3e7', color: '#c87941', border: '1px solid #ede5d8', fontSize: 13, fontWeight: 600 }}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p style={{ padding: 40, textAlign: 'center', color: '#8a7060' }}>No handoffs in this view.</p>
        ) : (
          items.map((e) => {
            const st = STATUS_STYLE[e.status];
            return (
              <div key={e.id} style={{ borderTop: '1px solid #f0e9dc', padding: '14px 16px' }}>
                <div className="flex items-start justify-between gap-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontWeight: 600, color: '#2a1f17' }}>{leadName(e)}</span>
                      <span style={{ background: st.background, color: st.color, fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6 }}>{e.status}</span>
                      <span style={{ fontSize: 12, color: '#a08c78' }}>{REASON_LABEL[e.reason]}</span>
                    </div>
                    {e.trigger_context && <div style={{ fontSize: 13, color: '#7a6a5a', marginTop: 3 }}>{e.trigger_context}</div>}
                    {e.smart_leads?.product_interest && <div style={{ fontSize: 12, color: '#a08c78', marginTop: 2 }}>Re: {e.smart_leads.product_interest}</div>}
                    {e.deal_value ? <div style={{ fontSize: 12, color: '#4a7c59', marginTop: 2 }}>Value: {money(e.deal_value)}</div> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2" style={{ flexShrink: 0 }}>
                    <input
                      placeholder="Assign rep…"
                      defaultValue={e.assigned_to_name || ''}
                      onBlur={(ev) => {
                        const v = ev.target.value.trim();
                        if (v !== (e.assigned_to_name || '')) patch(e.id, { assigned_to_name: v || null });
                      }}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e4dccd', background: '#fff', fontSize: 12, width: 130 }}
                    />
                    {NEXT_STATUSES[e.status]?.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end" style={{ maxWidth: 220 }}>
                        {NEXT_STATUSES[e.status].map((s) => (
                          <button
                            key={s}
                            onClick={() => setStatus(e, s)}
                            style={{ padding: '4px 9px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #e4dccd', background: '#faf6ef', color: '#7a6a5a' }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
