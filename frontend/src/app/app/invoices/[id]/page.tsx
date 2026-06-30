'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type LineItem = { description: string; qty: number; unit_price: number; total: number };
type Invoice = {
  id: string;
  invoice_number: string;
  direction: 'outbound' | 'inbound';
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  customer_phone: string | null;
  vendor_name: string | null;
  vendor_email: string | null;
  vendor_company: string | null;
  line_items: LineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  payment_terms: string | null;
  notes: string | null;
  source_channel: string | null;
  file_url: string | null;
  ai_extracted: Record<string, unknown> | null;
  quote_id: string | null;
  lead_id: string | null;
};

const STATUSES = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled'];

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  draft:     { background: '#f5f0e8', color: '#7a6a5a' },
  sent:      { background: '#e6f0fb', color: '#185FA5' },
  viewed:    { background: '#ede8f5', color: '#5a3f8a' },
  paid:      { background: '#eef7f1', color: '#4a7c59' },
  overdue:   { background: '#fdecea', color: '#c0392b' },
  cancelled: { background: '#f5f5f5', color: '#999' },
};

function fmt(amount: number, currency = 'GBP') {
  const s: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AED: 'د.إ', PKR: '₨', INR: '₹' };
  return (s[currency] || currency + ' ') + Number(amount ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || { bg: '#f5f5f5', color: '#999' };
  return (
    <span
      className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
      style={{ background: style.background, color: style.color }}
    >
      {status}
    </span>
  );
}

export default function InvoiceDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [status, setStatus]   = useState('');

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then(r => r.json())
      .then(d => {
        setInvoice(d.invoice);
        setStatus(d.invoice?.status || '');
        setLoading(false);
      });
  }, [id]);

  const updateStatus = async (newStatus: string) => {
    setSaving(true);
    const res = await fetch(`/api/invoices/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    setInvoice(data.invoice);
    setStatus(data.invoice?.status);
    setSaving(false);
  };

  const downloadPdf = () => {
    window.open(`/api/invoices/${id}/pdf`, '_blank');
  };

  const deleteInvoice = async () => {
    if (!confirm('Cancel this invoice?')) return;
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
    router.push('/app/invoices');
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#faf8f5' }}>
      <div className="size-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#c87941', borderTopColor: 'transparent' }} />
    </div>
  );
  if (!invoice) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#faf8f5' }}>
      <p className="text-sm" style={{ color: '#7a6a5a' }}>Invoice not found.</p>
    </div>
  );

  const isOutbound = invoice.direction === 'outbound';
  const fromParty  = isOutbound
    ? { name: 'Your Business', company: null, email: null }
    : { name: invoice.vendor_name, company: invoice.vendor_company, email: invoice.vendor_email };
  const toParty    = isOutbound
    ? { name: invoice.customer_name, company: invoice.customer_company, email: invoice.customer_email, phone: invoice.customer_phone }
    : { name: 'Your Business', company: null, email: null, phone: null };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto" style={{ background: '#faf8f5', minHeight: '100vh' }}>

      {/* Back */}
      <Link
        href="/app/invoices"
        className="inline-flex items-center gap-1.5 text-sm mb-6 transition-colors"
        style={{ color: '#7a6a5a' }}
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Invoices
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Invoice document */}
        <div className="lg:col-span-2">
          <div className="rounded-xl p-8" style={{ background: 'white', border: '1px solid #ede5d8' }}>

            {/* Invoice header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <div
                  className="size-10 rounded-xl flex items-center justify-center font-bold text-white text-sm mb-3"
                  style={{ background: '#c87941' }}
                >
                  IS
                </div>
                <p className="font-semibold text-lg" style={{ color: '#1c1612' }}>INVOICE</p>
                <p className="text-sm font-mono" style={{ color: '#7a6a5a' }}>#{invoice.invoice_number}</p>
              </div>
              <div className="text-right">
                <StatusBadge status={invoice.status} />
                <p className="text-sm mt-2" style={{ color: '#7a6a5a' }}>
                  Issued: {fmtDate(invoice.issue_date)}
                </p>
                {invoice.due_date && (
                  <p className="text-sm" style={{ color: '#7a6a5a' }}>
                    Due: {fmtDate(invoice.due_date)}
                  </p>
                )}
              </div>
            </div>

            {/* From / To */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#b8a898' }}>From</p>
                {fromParty.name  && <p className="font-semibold text-sm" style={{ color: '#1c1612' }}>{fromParty.name}</p>}
                {fromParty.company && <p className="text-sm" style={{ color: '#7a6a5a' }}>{fromParty.company}</p>}
                {fromParty.email   && <p className="text-sm" style={{ color: '#7a6a5a' }}>{fromParty.email}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#b8a898' }}>To</p>
                {toParty.name    && <p className="font-semibold text-sm" style={{ color: '#1c1612' }}>{toParty.name}</p>}
                {toParty.company && <p className="text-sm" style={{ color: '#7a6a5a' }}>{toParty.company}</p>}
                {toParty.email   && <p className="text-sm" style={{ color: '#7a6a5a' }}>{toParty.email}</p>}
                {toParty.phone   && <p className="text-sm" style={{ color: '#7a6a5a' }}>{toParty.phone}</p>}
              </div>
            </div>

            {/* Line items table */}
            {invoice.line_items?.length > 0 ? (
              <>
                <table className="w-full mb-6">
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ede5d8' }}>
                      <th className="text-left py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Description</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Qty</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Unit price</th>
                      <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#b8a898' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items.map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f5ede4' }}>
                        <td className="py-3 text-sm" style={{ color: '#1c1612' }}>{item.description}</td>
                        <td className="py-3 text-sm text-right" style={{ color: '#7a6a5a' }}>{item.qty}</td>
                        <td className="py-3 text-sm text-right" style={{ color: '#7a6a5a' }}>{fmt(item.unit_price, invoice.currency)}</td>
                        <td className="py-3 text-sm text-right font-medium" style={{ color: '#1c1612' }}>{fmt(item.total, invoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-56">
                    <div className="flex justify-between py-1.5 text-sm" style={{ color: '#7a6a5a' }}>
                      <span>Subtotal</span>
                      <span>{fmt(invoice.subtotal, invoice.currency)}</span>
                    </div>
                    {invoice.tax_rate > 0 && (
                      <div className="flex justify-between py-1.5 text-sm" style={{ color: '#7a6a5a' }}>
                        <span>Tax ({invoice.tax_rate}%)</span>
                        <span>{fmt(invoice.tax_amount, invoice.currency)}</span>
                      </div>
                    )}
                    <div
                      className="flex justify-between py-2 font-semibold text-base border-t mt-1"
                      style={{ borderColor: '#ede5d8', color: '#1c1612' }}
                    >
                      <span>Total</span>
                      <span>{fmt(invoice.total_amount, invoice.currency)}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-center py-6" style={{ color: '#b8a898' }}>No line items</p>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="mt-6 pt-6" style={{ borderTop: '1px solid #ede5d8' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#b8a898' }}>Notes</p>
                <p className="text-sm whitespace-pre-wrap" style={{ color: '#7a6a5a' }}>{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions sidebar */}
        <div className="space-y-4">

          {/* Actions card */}
          <div className="rounded-xl p-5" style={{ background: 'white', border: '1px solid #ede5d8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: '#b8a898' }}>Actions</p>

            {isOutbound && (
              <button
                onClick={downloadPdf}
                className="w-full py-2.5 rounded-lg text-white text-sm font-medium mb-2 transition-all"
                style={{ background: '#c87941' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#b36a35')}
                onMouseLeave={e => (e.currentTarget.style.background = '#c87941')}
              >
                Download PDF
              </button>
            )}

            {invoice.file_url && (
              <a
                href={invoice.file_url}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 rounded-lg text-sm font-medium mb-2 block text-center transition-all"
                style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
              >
                View Attached File
              </a>
            )}

            {invoice.lead_id && (
              <Link
                href={`/app/leads/${invoice.lead_id}`}
                className="w-full py-2.5 rounded-lg text-sm font-medium mb-2 block text-center transition-all"
                style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
              >
                View Lead
              </Link>
            )}

            {invoice.quote_id && (
              <Link
                href="/app/quotes"
                className="w-full py-2.5 rounded-lg text-sm font-medium mb-2 block text-center transition-all"
                style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
              >
                Source Quote
              </Link>
            )}

            <p className="text-xs font-semibold uppercase tracking-wide mb-2 mt-4" style={{ color: '#b8a898' }}>Update Status</p>
            <select
              value={status}
              disabled={saving}
              onChange={e => { setStatus(e.target.value); updateStatus(e.target.value); }}
              className="w-full py-2 px-3 rounded-lg text-sm"
              style={{ border: '1px solid #ede5d8', color: '#1c1612', background: 'white' }}
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>

            {invoice.paid_date && (
              <p className="text-xs mt-2" style={{ color: '#4a7c59' }}>
                Paid on {fmtDate(invoice.paid_date)}
              </p>
            )}

            <button
              onClick={deleteInvoice}
              className="w-full py-2 rounded-lg text-sm font-medium mt-4 transition-all"
              style={{ border: '1px solid #fdecea', color: '#c0392b', background: '#fdecea' }}
            >
              Cancel Invoice
            </button>
          </div>

          {/* Meta card */}
          <div className="rounded-xl p-5" style={{ background: 'white', border: '1px solid #ede5d8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#b8a898' }}>Details</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span style={{ color: '#7a6a5a' }}>Direction</span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                  style={isOutbound
                    ? { background: '#fdf3e7', color: '#c87941' }
                    : { background: '#f0e8df', color: '#7a6a5a' }}
                >
                  {invoice.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#7a6a5a' }}>Payment terms</span>
                <span className="font-medium" style={{ color: '#1c1612' }}>{invoice.payment_terms || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#7a6a5a' }}>Source</span>
                <span className="font-medium capitalize" style={{ color: '#1c1612' }}>{invoice.source_channel || '—'}</span>
              </div>
              {invoice.ai_extracted && (
                <div className="flex items-center gap-1.5 mt-2 pt-2" style={{ borderTop: '1px solid #f5ede4' }}>
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="#c87941" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <span className="text-xs" style={{ color: '#c87941' }}>AI-extracted data</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
