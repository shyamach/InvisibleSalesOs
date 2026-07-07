'use client';

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

type Mode = 'auto' | 'window' | 'manual';
type Config = {
  enabled: boolean;
  priority_rules: { HIGH: Mode; MEDIUM: Mode; LOW: Mode };
  window_minutes: number;
};

const DEFAULT: Config = {
  enabled: false,
  priority_rules: { HIGH: 'manual', MEDIUM: 'window', LOW: 'auto' },
  window_minutes: 30,
};

const MODE_HELP: Record<Mode, string> = {
  auto: 'Send immediately, no approval',
  window: 'Auto-send after the window unless rejected',
  manual: 'Always wait for human approval',
};

export default function AutoReplySettingsPage() {
  const { getAuthHeaders } = useAuth();
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/auto-reply', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.auto_reply) setCfg({ ...DEFAULT, ...d.auto_reply, priority_rules: { ...DEFAULT.priority_rules, ...d.auto_reply.priority_rules } }); })
      .finally(() => setLoading(false));
  }, [getAuthHeaders]);

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    const res = await fetch('/api/settings/auto-reply', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(cfg),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.success) { setError(data.error || 'Save failed'); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const setRule = (p: keyof Config['priority_rules'], mode: Mode) =>
    setCfg((c) => ({ ...c, priority_rules: { ...c.priority_rules, [p]: mode } }));

  const card = { background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: 12, padding: '18px 20px' } as React.CSSProperties;
  const label = { fontSize: 13, fontWeight: 600, color: '#2a1f17' } as React.CSSProperties;

  if (loading) return <div style={{ padding: 32, color: '#8a7060' }}>Loading…</div>;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 720 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,121,65,0.12)', width: 40, height: 40 }}>
          <Zap className="size-5" style={{ color: '#c87941' }} strokeWidth={1.6} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2a1f17' }}>Auto-reply</h1>
          <p style={{ fontSize: 13, color: '#8a7060' }}>Control when the AI sends replies on its own</p>
        </div>
      </div>

      {/* Master toggle */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div className="flex items-center justify-between">
          <div>
            <div style={label}>Enable auto-reply</div>
            <div style={{ fontSize: 12, color: '#8a7060', marginTop: 2 }}>When off, every draft waits for your approval.</div>
          </div>
          <button
            onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            aria-pressed={cfg.enabled}
            style={{
              width: 46, height: 26, borderRadius: 999, position: 'relative',
              background: cfg.enabled ? '#c87941' : '#d8cdbb', transition: 'background 0.15s',
            }}
          >
            <span style={{ position: 'absolute', top: 3, left: cfg.enabled ? 23 : 3, width: 20, height: 20, borderRadius: 999, background: '#fff', transition: 'left 0.15s' }} />
          </button>
        </div>
      </div>

      {/* Per-priority rules */}
      <div style={{ ...card, marginBottom: 16, opacity: cfg.enabled ? 1 : 0.55, pointerEvents: cfg.enabled ? 'auto' : 'none' }}>
        <div style={{ ...label, marginBottom: 4 }}>Per-priority behaviour</div>
        <div style={{ fontSize: 12, color: '#8a7060', marginBottom: 14 }}>HIGH-priority leads are always manual for safety.</div>
        {(['HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
          <div key={p} className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: p !== 'HIGH' ? '1px solid #f0e9dc' : 'none' }}>
            <div>
              <div style={{ fontWeight: 600, color: '#2a1f17' }}>{p}</div>
              <div style={{ fontSize: 12, color: '#a08c78' }}>{MODE_HELP[cfg.priority_rules[p]]}</div>
            </div>
            <div className="flex gap-1">
              {(['auto', 'window', 'manual'] as Mode[]).map((m) => {
                const active = cfg.priority_rules[p] === m;
                const disabled = p === 'HIGH' && m !== 'manual';
                return (
                  <button
                    key={m}
                    disabled={disabled}
                    onClick={() => setRule(p, m)}
                    style={{
                      padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      border: '1px solid ' + (active ? '#c87941' : '#e4dccd'),
                      background: active ? 'rgba(200,121,65,0.12)' : '#fff',
                      color: disabled ? '#cbbfae' : active ? '#c87941' : '#7a6a5a',
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Window length */}
      <div style={{ ...card, marginBottom: 20, opacity: cfg.enabled ? 1 : 0.55, pointerEvents: cfg.enabled ? 'auto' : 'none' }}>
        <div style={label}>Approval window</div>
        <div style={{ fontSize: 12, color: '#8a7060', margin: '2px 0 10px' }}>How long a “window” draft waits before auto-sending (unless you reject it).</div>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={1440} value={cfg.window_minutes}
            onChange={(e) => setCfg((c) => ({ ...c, window_minutes: parseInt(e.target.value || '0', 10) }))}
            style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid #e4dccd', background: '#fffdf9', fontSize: 14 }}
          />
          <span style={{ fontSize: 13, color: '#7a6a5a' }}>minutes</span>
        </div>
      </div>

      {error && <p style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} style={{ padding: '10px 20px', borderRadius: 8, background: '#c87941', color: '#fff', fontWeight: 600, fontSize: 14, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span style={{ color: '#4a7c59', fontSize: 13, fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
