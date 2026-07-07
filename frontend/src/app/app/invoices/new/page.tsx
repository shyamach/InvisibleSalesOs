'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

type LineItem = { description: string; qty: number; unit_price: number; total: number };

const CURRENCIES = ['GBP', 'USD', 'EUR', 'AED', 'PKR', 'INR'];

const inputStyle: React.CSSProperties = {
  border: '1px solid #ede5d8',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '14px',
  color: '#1c1612',
  width: '100%',
  outline: 'none',
  background: 'white',
};

function FormInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: '#7a6a5a' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{
          ...inputStyle,
          borderColor: focused ? '#c87941' : '#ede5d8',
          boxShadow: focused ? '0 0 0 3px rgba(200,121,65,0.12)' : 'none',
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

export default function NewInvoicePage() {
  const { getAuthHeaders } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_name:    '',
    customer_email:   '',
    customer_company: '',
    customer_phone:   '',
    currency:         'GBP',
    issue_date:       new Date().toISOString().split('T')[0],
    due_date:         '',
    payment_terms:    'Net 30',
    notes:            '',
    tax_rate:         0,
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', qty: 1, unit_price: 0, total: 0 },
  ]);

  const setField = (key: string, value: string | number) =>
    setForm(f => ({ ...f, [key]: value }));

  const updateLineItem = (i: number, key: keyof LineItem, raw: string) => {
    setLineItems(prev => {
      const updated = [...prev];
      const item    = { ...updated[i] };
      (item as Record<string, string | number>)[key] = key === 'description' ? raw : Number(raw);
      if (key === 'qty' || key === 'unit_price') {
        item.total = Number((item.qty * item.unit_price).toFixed(2));
      }
      if (key === 'total') item.total = Number(raw);
      updated[i] = item;
      return updated;
    });
  };

  const addLine = () =>
    setLineItems(prev => [...prev, { description: '', qty: 1, unit_price: 0, total: 0 }]);

  const removeLine = (i: number) =>
    setLineItems(prev => prev.filter((_, idx) => idx !== i));

  const subtotal  = lineItems.reduce((s, i) => s + i.total, 0);
  const taxAmount = subtotal * (form.tax_rate / 100);
  const total     = subtotal + taxAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const res = await fetch('/api/invoices', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body:    JSON.stringify({ ...form, line_items: lineItems }),
    });

    if (res.ok) {
      const data = await res.json();
      router.push(`/app/invoices/${data.invoice.id}`);
    } else {
      alert('Failed to create invoice.');
      setSaving(false);
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid #ede5d8',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '16px',
  };

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#1c1612',
    marginBottom: '16px',
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto" style={{ background: '#faf8f5', minHeight: '100vh' }}>

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

      <form onSubmit={handleSubmit}>
        <div className="rounded-2xl p-8 mb-6" style={{ background: 'white', border: '1px solid #ede5d8' }}>
          <h1 className="text-xl font-semibold mb-6" style={{ color: '#1c1612' }}>New invoice</h1>

          {/* Bill To */}
          <div style={{ ...sectionStyle, background: '#faf8f5' }}>
            <p style={sectionHeadingStyle}>Bill to</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormInput
                label="Customer name"
                value={form.customer_name}
                onChange={v => setField('customer_name', v)}
                placeholder="Ahmed Khan"
              />
              <FormInput
                label="Company"
                value={form.customer_company}
                onChange={v => setField('customer_company', v)}
                placeholder="Khan Traders"
              />
              <FormInput
                label="Email"
                type="email"
                value={form.customer_email}
                onChange={v => setField('customer_email', v)}
                placeholder="ahmed@example.com"
              />
              <FormInput
                label="Phone"
                value={form.customer_phone}
                onChange={v => setField('customer_phone', v)}
                placeholder="+44 7700 900000"
              />
            </div>
          </div>

          {/* Invoice details */}
          <div style={{ ...sectionStyle, background: '#faf8f5' }}>
            <p style={sectionHeadingStyle}>Invoice details</p>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#7a6a5a' }}>Currency</label>
                <select
                  value={form.currency}
                  onChange={e => setField('currency', e.target.value)}
                  style={{ ...inputStyle }}
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <FormInput
                label="Issue date"
                type="date"
                value={form.issue_date}
                onChange={v => setField('issue_date', v)}
              />
              <FormInput
                label="Due date"
                type="date"
                value={form.due_date}
                onChange={v => setField('due_date', v)}
              />
              <FormInput
                label="Payment terms"
                value={form.payment_terms}
                onChange={v => setField('payment_terms', v)}
                placeholder="Net 30"
              />
              <FormInput
                label="Tax rate (%)"
                type="number"
                value={form.tax_rate}
                onChange={v => setField('tax_rate', Number(v))}
              />
            </div>
          </div>

          {/* Line items */}
          <div style={{ ...sectionStyle, background: '#faf8f5' }}>
            <div className="flex items-center justify-between mb-4">
              <p style={sectionHeadingStyle}>Line items</p>
              <button
                type="button"
                onClick={addLine}
                className="text-sm font-medium transition-colors"
                style={{ color: '#c87941' }}
              >
                + Add item
              </button>
            </div>

            <div className="hidden sm:grid grid-cols-12 gap-2 mb-2 px-1">
              {['Description', 'Qty', 'Unit price', 'Total', ''].map((h, i) => (
                <span
                  key={i}
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    i === 0 ? 'col-span-5' : i === 4 ? 'col-span-1' : 'col-span-2 text-right'
                  }`}
                  style={{ color: '#b8a898' }}
                >
                  {h}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="col-span-5 text-sm"
                    placeholder="Description"
                    value={item.description}
                    onChange={e => updateLineItem(i, 'description', e.target.value)}
                    style={{ ...inputStyle }}
                  />
                  <input
                    className="col-span-2 text-sm text-right"
                    type="number"
                    min={0}
                    value={item.qty}
                    onChange={e => updateLineItem(i, 'qty', e.target.value)}
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                  <input
                    className="col-span-2 text-sm text-right"
                    type="number"
                    min={0}
                    step={0.01}
                    value={item.unit_price}
                    onChange={e => updateLineItem(i, 'unit_price', e.target.value)}
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                  <div className="col-span-2 text-right text-sm font-semibold" style={{ color: '#1c1612' }}>
                    {Number(item.total).toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="col-span-1 text-lg leading-none transition-colors"
                    style={{ color: '#b8a898' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-5 pt-4 flex flex-col items-end gap-1.5 text-sm" style={{ borderTop: '1px solid #ede5d8' }}>
              <div className="flex gap-10" style={{ color: '#7a6a5a' }}>
                <span>Subtotal</span>
                <span>{subtotal.toFixed(2)}</span>
              </div>
              {form.tax_rate > 0 && (
                <div className="flex gap-10" style={{ color: '#7a6a5a' }}>
                  <span>Tax ({form.tax_rate}%)</span>
                  <span>{taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex gap-10 font-semibold text-base pt-1" style={{ color: '#1c1612', borderTop: '1px solid #ede5d8', marginTop: '4px', paddingTop: '8px' }}>
                <span>Total ({form.currency})</span>
                <span>{total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={{ ...sectionStyle, background: '#faf8f5', marginBottom: 0 }}>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#7a6a5a' }}>
              Notes <span style={{ color: '#b8a898', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={3}
              placeholder="Payment instructions, thank you note, etc."
              style={{ ...inputStyle, resize: 'none' }}
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-3">
          <Link
            href="/app/invoices"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ border: '1px solid #ede5d8', color: '#7a6a5a' }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: '#c87941' }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = '#b36a35'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#c87941'; }}
          >
            {saving ? 'Creating…' : 'Create invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}
