'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

type Invoice = {
  id: string;
  invoice_number: string;
  direction: 'outbound' | 'inbound';
  status: 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled';
  customer_name: string | null;
  customer_company: string | null;
  vendor_name: string | null;
  vendor_company: string | null;
  total_amount: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
  source_channel: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  draft:     { background: '#f5f0e8', color: '#7a6a5a' },
  sent:      { background: '#e6f0fb', color: '#185FA5' },
  viewed:    { background: '#ede8f5', color: '#5a3f8a' },
  paid:      { background: '#eef7f1', color: '#4a7c59' },
  overdue:   { background: '#fdecea', color: '#c0392b' },
  cancelled: { background: '#f5f5f5', color: '#999' },
};

const CHANNEL_ICON: Record<string, string> = {
  email:    '📧',
  whatsapp: '💬',
  manual:   '📁',
  quote:    '📄',
};

function formatMoney(amount: number, currency = 'GBP') {
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AED: 'د.إ', PKR: '₨', INR: '₹' };
  return (symbols[currency] || currency + ' ') + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function InvoicesPage() {
  const { getAuthHeaders } = useAuth();
  const [invoices, setInvoices]         = useState<Invoice[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<'All' | 'Outbound' | 'Inbound'>('All');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'All')   params.set('direction', tab.toLowerCase());
    if (statusFilter)    params.set('status', statusFilter);

    const res  = await fetch(`/api/invoices?${params}`, { headers: getAuthHeaders() });
    const data = await res.json();
    setInvoices(data.invoices || []);
    setLoading(false);
  }, [tab, statusFilter, getAuthHeaders]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const displayName = (inv: Invoice) => {
    if (inv.direction === 'outbound') return inv.customer_name || inv.customer_company || '—';
    return inv.vendor_name || inv.vendor_company || '—';
  };

  const pendingTotal   = invoices.filter(i => i.status === 'sent' || i.status === 'viewed').reduce((s, i) => s + i.total_amount, 0);
  const paidThisMonth  = invoices.filter(i => {
    if (i.status !== 'paid') return false;
    const d = new Date(i.issue_date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((s, i) => s + i.total_amount, 0);
  const overdueCount   = invoices.filter(i => i.status === 'overdue').length;

  const stats = [
    { label: 'Outstanding',      value: formatMoney(pendingTotal),       accent: '#c87941' },
    { label: 'Paid this month',  value: formatMoney(paidThisMonth),      accent: '#4a7c59' },
    { label: 'Overdue',          value: overdueCount.toString(),          accent: overdueCount > 0 ? '#c0392b' : '#b8a898' },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto" style={{ minHeight: '100vh', background: '#faf8f5' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1c1612' }}>Invoices</h1>
          <p className="text-sm mt-0.5" style={{ color: '#7a6a5a' }}>Outbound billing + inbound invoice scanning</p>
        </div>
        <div className="flex gap-2">
          <label
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all"
            style={{ background: 'white', border: '1px solid #ede5d8', color: '#7a6a5a' }}
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Invoice
            <input
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append('invoice', file);
                const res = await fetch('/api/invoices/upload', { method: 'POST', headers: getAuthHeaders(), body: form });
                if (res.ok) fetchInvoices();
                else alert('Upload failed');
              }}
            />
          </label>
          <Link
            href="/app/invoices/new"
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
            style={{ background: '#c87941' }}
          >
            + New Invoice
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl p-5" style={{ background: 'white', border: '1px solid #ede5d8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#b8a898' }}>{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#f0e8df' }}>
          {(['All', 'Outbound', 'Inbound'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={tab === t
                ? { background: 'white', color: '#1c1612', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#7a6a5a' }}
            >
              {t}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{ border: '1px solid #ede5d8', color: '#1c1612', background: 'white' }}
        >
          <option value="">All statuses</option>
          {['draft','sent','viewed','paid','overdue','cancelled'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'white', border: '1px solid #ede5d8' }}>
        {loading ? (
          <div className="p-12 text-center text-sm" style={{ color: '#b8a898' }}>Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#fdf3e7' }}>
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="#c87941" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: '#1c1612' }}>No invoices yet</p>
            <p className="text-xs" style={{ color: '#b8a898' }}>
              Create one from a quote, or send a PDF via WhatsApp/email to auto-capture it.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #ede5d8' }}>
                  {['Invoice #', 'Party', 'Type', 'Status', 'Amount', 'Due', ''].map(h => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-left${h === 'Amount' ? ' text-right' : ''}`}
                      style={{ color: '#b8a898' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr
                    key={inv.id}
                    style={{
                      borderBottom: idx < invoices.length - 1 ? '1px solid #f5ede4' : 'none',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fdf9f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono font-medium" style={{ color: '#1c1612' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs" style={{ color: '#b8a898' }}>
                          {inv.direction === 'outbound' ? '↑' : '↓'}
                        </span>
                        {inv.invoice_number}
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: '#1c1612' }}>{displayName(inv)}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
                        style={inv.direction === 'outbound'
                          ? { background: '#fdf3e7', color: '#c87941' }
                          : { background: '#f0e8df', color: '#7a6a5a' }}
                      >
                        {inv.direction === 'outbound' ? 'Outbound' : 'Inbound'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                        style={STATUS_STYLES[inv.status] || { background: '#f5f5f5', color: '#999' }}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: '#1c1612' }}>
                      {formatMoney(inv.total_amount, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs hidden md:table-cell" style={{ color: '#7a6a5a' }}>
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/invoices/${inv.id}`}
                        className="text-xs font-medium transition-colors"
                        style={{ color: '#c87941' }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
