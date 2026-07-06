'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Package, Plus, Pencil, Trash2, ArrowUpDown, Upload } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

const createSbClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

type Product = {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: string;
  stock_quantity: number;
  unit: string;
  status: 'active' | 'archived' | 'out_of_stock';
};

type FormState = {
  name: string;
  sku: string;
  category: string;
  price: string;
  unit: string;
  stock_quantity: string;
  description: string;
  status: Product['status'];
};

const EMPTY_FORM: FormState = {
  name: '', sku: '', category: '', price: '', unit: 'unit', stock_quantity: '0', description: '', status: 'active',
};

const STATUS_STYLES: Record<string, { background: string; color: string; label: string }> = {
  active:       { background: '#eef7f1', color: '#4a7c59', label: 'Active' },
  out_of_stock: { background: '#fdecea', color: '#c0392b', label: 'Out of stock' },
  archived:     { background: '#f5f5f5', color: '#999',    label: 'Archived' },
};

function money(amount: number, currency = 'GBP') {
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AED: 'د.إ', PKR: '₨', INR: '₹' };
  return (symbols[currency] || currency + ' ') + Number(amount || 0).toFixed(2);
}

export default function CataloguePage() {
  const { getAuthHeaders } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [stockDelta, setStockDelta] = useState('');
  const [stockReason, setStockReason] = useState('restock');

  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: { row: number; field?: string; message: string }[] } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleCSVImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/products/import', { method: 'POST', headers: getAuthHeaders(), body: form });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) {
      setImportResult({ created: 0, skipped: 0, errors: [{ row: 0, message: data.error || 'Import failed' }] });
      return;
    }
    setImportResult(data);
    fetchProducts();
  };

  const supabase = createSbClient();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/products', { headers: getAuthHeaders() });
    const data = await res.json();
    setProducts(data.products || []);
    setLoading(false);
  }, [getAuthHeaders]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const channel = supabase
      .channel('products-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchProducts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchProducts]);

  // ── Form handlers ───────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(null); setShowForm(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', category: p.category || '', price: String(p.price),
      unit: p.unit, stock_quantity: String(p.stock_quantity), description: p.description || '', status: p.status,
    });
    setError(null);
    setShowForm(true);
  };

  const saveProduct = async () => {
    setSaving(true); setError(null);
    const payload: Record<string, unknown> = {
      name: form.name, sku: form.sku || undefined, category: form.category || undefined,
      price: form.price || 0, unit: form.unit || 'unit',
      description: form.description || undefined, status: form.status,
    };
    // Stock is only set on create; edits use the stock-adjust flow (keeps the ledger honest).
    if (!editing) payload.stock_quantity = form.stock_quantity || 0;

    const url = editing ? `/api/products/${editing.id}` : '/api/products';
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.success) { setError(data.error || 'Save failed'); return; }
    setShowForm(false);
    fetchProducts();
  };

  const removeProduct = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? This can't be undone from here.`)) return;
    await fetch(`/api/products/${p.id}`, { method: 'DELETE', headers: getAuthHeaders() });
    fetchProducts();
  };

  const submitStock = async () => {
    if (!stockFor) return;
    const delta = parseInt(stockDelta, 10);
    if (!delta) { setError('Enter a non-zero whole number'); return; }
    setSaving(true); setError(null);
    const res = await fetch(`/api/products/${stockFor.id}/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ delta, reason: stockReason }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.success) { setError(data.error || 'Adjustment failed'); return; }
    setStockFor(null); setStockDelta(''); setStockReason('restock');
    fetchProducts();
  };

  // ── Derived ───────────────────────────────────────────────────────────────────
  const filtered = products.filter((p) =>
    !search || [p.name, p.sku, p.category].some((f) => (f || '').toLowerCase().includes(search.toLowerCase()))
  );
  const stockValue = products.reduce((s, p) => s + p.price * p.stock_quantity, 0);
  const outOfStock = products.filter((p) => p.stock_quantity <= 0).length;

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e4dccd',
    background: '#fffdf9', fontSize: '14px', color: '#2a1f17',
  } as React.CSSProperties;
  const labelStyle = { fontSize: '12px', fontWeight: 600, color: '#7a6a5a', marginBottom: '4px', display: 'block' } as React.CSSProperties;

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '20px' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,121,65,0.12)', width: 40, height: 40 }}>
            <Package className="size-5" style={{ color: '#c87941' }} strokeWidth={1.6} />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#2a1f17' }}>Catalogue</h1>
            <p style={{ fontSize: '13px', color: '#8a7060' }}>Products, pricing and live stock</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImport(true); setImportResult(null); }}
            className="flex items-center gap-2 rounded-lg font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#f5ede0', color: '#c87941', border: '1px solid #e4dccd', padding: '9px 14px', fontSize: '14px' }}
          >
            <Upload className="size-4" /> Import CSV
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#c87941', color: '#fff', padding: '9px 16px', fontSize: '14px' }}
          >
            <Plus className="size-4" /> Add product
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '20px' }}>
        {[
          { label: 'Products', value: String(products.length) },
          { label: 'Stock value', value: money(stockValue) },
          { label: 'Out of stock', value: String(outOfStock) },
        ].map((c) => (
          <div key={c.label} style={{ background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: '12px', padding: '14px 16px' }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8a7060' }}>{c.label}</p>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#2a1f17', marginTop: '4px' }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        placeholder="Search by name, SKU or category…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputStyle, maxWidth: '320px', marginBottom: '14px' }}
      />

      {/* Table */}
      <div style={{ background: '#fffdf9', border: '1px solid #ece3d4', borderRadius: '12px', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: '32px', textAlign: 'center', color: '#8a7060' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '40px', textAlign: 'center', color: '#8a7060' }}>
            No products yet. Click <strong>Add product</strong> to build your catalogue.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#faf6ef', color: '#7a6a5a', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Product</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>SKU</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Price</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Stock</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const st = STATUS_STYLES[p.status] || STATUS_STYLES.active;
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #f0e9dc' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#2a1f17' }}>{p.name}</div>
                      {p.category && <div style={{ fontSize: '12px', color: '#a08c78' }}>{p.category}</div>}
                    </td>
                    <td style={{ padding: '11px 14px', color: '#7a6a5a' }}>{p.sku || '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#2a1f17' }}>{money(p.price, p.currency)}<span style={{ color: '#a08c78', fontSize: 12 }}> /{p.unit}</span></td>
                    <td style={{ padding: '11px 14px', color: p.stock_quantity <= 0 ? '#c0392b' : '#2a1f17', fontWeight: 600 }}>{p.stock_quantity}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ background: st.background, color: st.color, fontSize: '12px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px' }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => { setStockFor(p); setError(null); }} title="Adjust stock" style={{ padding: 6, color: '#7a6a5a' }}><ArrowUpDown className="size-4" /></button>
                        <button onClick={() => openEdit(p)} title="Edit" style={{ padding: 6, color: '#7a6a5a' }}><Pencil className="size-4" /></button>
                        <button onClick={() => removeProduct(p)} title="Delete" style={{ padding: 6, color: '#c0392b' }}><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── CSV import modal ───────────────────────────────────────────────── */}
      {showImport && (
        <Modal onClose={() => setShowImport(false)} title="Import products from CSV">
          <p style={{ fontSize: 13, color: '#7a6a5a', marginBottom: 14 }}>
            Upload a <strong>.csv</strong> file with columns: <code>name</code>, <code>sku</code>, <code>price</code>, <code>stock_quantity</code>, <code>unit</code>, <code>category</code>, <code>description</code>.<br />
            Only <strong>name</strong> is required. Duplicate SKUs are skipped. Max 2 MB / 2,000 rows.
          </p>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCSVImport(file);
              e.target.value = '';
            }}
          />

          {!importResult && (
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importing}
              className="flex items-center justify-center gap-2 w-full rounded-lg font-semibold transition-opacity hover:opacity-90"
              style={{ background: '#c87941', color: '#fff', padding: '12px', fontSize: '14px', opacity: importing ? 0.6 : 1 }}
            >
              <Upload className="size-4" />
              {importing ? 'Importing…' : 'Choose CSV file'}
            </button>
          )}

          {importResult && (
            <div style={{ marginTop: 8 }}>
              <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 12 }}>
                <div style={{ background: '#eef7f1', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: '#4a7c59' }}>{importResult.created}</p>
                  <p style={{ fontSize: 12, color: '#4a7c59' }}>Created</p>
                </div>
                <div style={{ background: '#faf6ef', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: '#8a7060' }}>{importResult.skipped}</p>
                  <p style={{ fontSize: 12, color: '#8a7060' }}>Skipped (duplicate SKU)</p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div style={{ background: '#fdecea', borderRadius: 8, padding: '10px 12px', maxHeight: 160, overflowY: 'auto' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#c0392b', marginBottom: 6 }}>
                    {importResult.errors.length} row error{importResult.errors.length !== 1 ? 's' : ''}
                  </p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} style={{ fontSize: 12, color: '#c0392b', marginBottom: 2 }}>
                      {e.row > 0 ? `Row ${e.row}: ` : ''}{e.field ? `[${e.field}] ` : ''}{e.message}
                    </p>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setImportResult(null); csvInputRef.current?.click(); }}
                style={{ marginTop: 12, width: '100%', padding: '9px', borderRadius: 8, border: '1px solid #e4dccd', color: '#7a6a5a', fontSize: 14 }}
              >
                Import another file
              </button>
            </div>
          )}

          <div className="flex justify-end" style={{ marginTop: 16 }}>
            <button onClick={() => setShowImport(false)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e4dccd', color: '#7a6a5a', fontSize: 14 }}>Close</button>
          </div>
        </Modal>
      )}

      {/* ── Add/Edit modal ─────────────────────────────────────────────────── */}
      {showForm && (
        <Modal onClose={() => setShowForm(false)} title={editing ? 'Edit product' : 'Add product'}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label style={labelStyle}>Name *</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={labelStyle}>SKU</label><input style={inputStyle} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div><label style={labelStyle}>Category</label><input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div><label style={labelStyle}>Price</label><input style={inputStyle} type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div><label style={labelStyle}>Unit</label><input style={inputStyle} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            {!editing && <div><label style={labelStyle}>Opening stock</label><input style={inputStyle} type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>}
            <div className={editing ? 'col-span-2' : ''}><label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Product['status'] })}>
                <option value="active">Active</option>
                <option value="out_of_stock">Out of stock</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="col-span-2"><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          {editing && <p style={{ fontSize: 12, color: '#a08c78', marginTop: 8 }}>Stock is changed via the adjust-stock action so every change is logged.</p>}
          {error && <p style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e4dccd', color: '#7a6a5a', fontSize: 14 }}>Cancel</button>
            <button onClick={saveProduct} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, background: '#c87941', color: '#fff', fontWeight: 600, fontSize: 14, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {/* ── Stock adjust modal ──────────────────────────────────────────────── */}
      {stockFor && (
        <Modal onClose={() => setStockFor(null)} title={`Adjust stock — ${stockFor.name}`}>
          <p style={{ fontSize: 13, color: '#7a6a5a', marginBottom: 12 }}>On hand: <strong>{stockFor.stock_quantity}</strong> {stockFor.unit}(s)</p>
          <label style={labelStyle}>Change (use a negative number to reduce)</label>
          <input style={inputStyle} type="number" placeholder="e.g. 50 or -10" value={stockDelta} onChange={(e) => setStockDelta(e.target.value)} />
          <label style={{ ...labelStyle, marginTop: 12 }}>Reason</label>
          <select style={inputStyle} value={stockReason} onChange={(e) => setStockReason(e.target.value)}>
            <option value="restock">Restock</option>
            <option value="sale">Sale</option>
            <option value="correction">Correction</option>
            <option value="return">Return</option>
            <option value="import">Import</option>
            <option value="manual_adjustment">Manual adjustment</option>
          </select>
          {error && <p style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
            <button onClick={() => setStockFor(null)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e4dccd', color: '#7a6a5a', fontSize: 14 }}>Cancel</button>
            <button onClick={submitStock} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, background: '#c87941', color: '#fff', fontWeight: 600, fontSize: 14, opacity: saving ? 0.6 : 1 }}>{saving ? 'Applying…' : 'Apply'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,22,18,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fffdf9', borderRadius: 14, padding: 22, width: '100%', maxWidth: 520, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2a1f17', marginBottom: 16 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
