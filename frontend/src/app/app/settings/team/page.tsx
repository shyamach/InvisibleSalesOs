'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';

type Member = { user_id: string; email: string; role: 'owner' | 'admin' | 'member'; joined_at: string };
const ROLES: Member['role'][] = ['owner', 'admin', 'member'];

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('member');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/team');
    const data = await res.json();
    setMembers(data.members || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true); setError(null);
    const res = await fetch('/api/team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), role }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok || !data.success) { setError(data.error || 'Could not add member'); return; }
    setEmail(''); load();
  };

  const changeRole = async (m: Member, newRole: string) => {
    setError(null);
    const res = await fetch(`/api/team/${m.user_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { setError(data.error || 'Could not change role'); return; }
    load();
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email} from the team?`)) return;
    setError(null);
    const res = await fetch(`/api/team/${m.user_id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) { setError(data.error || 'Could not remove member'); return; }
    load();
  };

  const card = { background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: 12 } as React.CSSProperties;
  const input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #e4dccd', background: '#fffdf9', fontSize: 14 } as React.CSSProperties;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 760 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,121,65,0.12)', width: 40, height: 40 }}>
          <Users className="size-5" style={{ color: '#c87941' }} strokeWidth={1.6} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2a1f17' }}>Team</h1>
          <p style={{ fontSize: 13, color: '#8a7060' }}>People who can access this account</p>
        </div>
      </div>

      {/* Add member */}
      <div style={{ ...card, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2a1f17', marginBottom: 10 }}>Add a team member</div>
        <div className="flex gap-2 items-center flex-wrap">
          <input placeholder="their@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} />
          <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} style={input}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={add} disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, background: '#c87941', color: '#fff', fontWeight: 600, fontSize: 14, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#a08c78', marginTop: 8 }}>
          They must have signed up first. (Email invites for brand-new users are coming soon.)
        </p>
        {error && <p style={{ color: '#c0392b', fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>

      {/* Member list */}
      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: 28, textAlign: 'center', color: '#8a7060' }}>Loading…</p>
        ) : members.length === 0 ? (
          <p style={{ padding: 36, textAlign: 'center', color: '#8a7060' }}>No members yet.</p>
        ) : (
          members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between" style={{ padding: '12px 16px', borderTop: '1px solid #f0e9dc' }}>
              <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: '#f0e6d8', color: '#c87941' }}>
                  {m.email?.[0]?.toUpperCase() || '?'}
                </div>
                <span style={{ color: '#2a1f17', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} style={{ ...input, padding: '5px 8px', fontSize: 13 }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => remove(m)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #f0d8d3', color: '#c0392b', fontSize: 13 }}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
