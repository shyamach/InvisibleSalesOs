"use client";

/**
 * New Quote — Quote creation form.
 * Lets the user pick a lead, build line items, set tax/currency/validity,
 * then save as a draft or mark as sent.
 *
 * On save: POST /api/quotes (authenticated — tenant_id and quote_number are
 * derived server-side from req.tenantId, never sent by the client).
 * On success: redirects to /app/quotes
 *
 * Lead search now calls GET /api/leads?search= (added 2026-08-18, Phase B
 * item B2) — this closes what was the last known Lane C dependency on this
 * page; the raw anon Supabase client here is gone.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ProductPickerInput, type ProductOption } from "@/components/product-picker";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  calculateQuoteTotals,
  computeLineItemAmount,
  statusBadgeClass,
  type LineItem,
} from "@/lib/quote-utils";
import {
  ArrowLeft,
  CheckCircle,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  X,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCIES = ["GBP", "USD", "EUR", "INR", "AED"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadOption {
  id: string;
  customer_name: string | null;
  company_name: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function emptyLineItem(): LineItem {
  return { description: "", qty: 1, unit_price: 0, amount: 0, product_id: null };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewQuotePage() {
  const router = useRouter();
  const { getAuthHeaders } = useAuth();

  // ── Form state ────────────────────────────────────────────────────────────
  const [leadId, setLeadId] = useState<string>("");
  const [leadSearch, setLeadSearch] = useState<string>("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);

  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()]);
  const [taxRate, setTaxRate] = useState<number>(20); // displayed as %
  const [currency, setCurrency] = useState<string>("GBP");
  const [notes, setNotes] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");

  // ── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Lead search ───────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async (query: string) => {
    if (!query.trim()) {
      setLeadOptions([]);
      return;
    }

    const res = await fetch(`/api/leads?search=${encodeURIComponent(query)}&limit=8`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    setLeadOptions(
      (json.leads ?? []).map((l: LeadOption) => ({
        id: l.id,
        customer_name: l.customer_name,
        company_name: l.company_name,
      }))
    );
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = setTimeout(() => fetchLeads(leadSearch), 200);
    return () => clearTimeout(timer);
  }, [leadSearch, fetchLeads]);

  // ── Line item helpers ──────────────────────────────────────────────────────

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) => {
      const updated = [...prev];
      updated[index] = computeLineItemAmount({
        ...updated[index],
        [field]: field === "description" ? value : Number(value),
      });
      return updated;
    });
  };

  const selectProductForLine = (index: number, product: ProductOption) => {
    setLineItems((prev) => {
      const updated = [...prev];
      updated[index] = computeLineItemAmount({
        ...updated[index],
        description: product.name,
        unit_price: product.price,
        product_id: product.id,
      });
      return updated;
    });
  };

  const clearProductForLine = (index: number) => {
    setLineItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], product_id: null };
      return updated;
    });
  };

  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()]);

  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  };

  // ── Computed totals ───────────────────────────────────────────────────────

  const totals = calculateQuoteTotals(lineItems, taxRate / 100);

  // ── Save handlers ──────────────────────────────────────────────────────────

  const handleSave = async (status: "draft" | "sent") => {
    if (lineItems.every((item) => !item.description.trim() && item.unit_price === 0)) {
      showToast("error", "Add at least one line item before saving.");
      return;
    }

    setSaving(true);

    const payload = {
      lead_id: leadId || null,
      line_items: lineItems.map(computeLineItemAmount),
      subtotal: totals.subtotal,
      tax_rate: taxRate / 100,
      tax_amount: totals.tax_amount,
      total: totals.total,
      currency,
      status,
      notes: notes.trim() || null,
      valid_until: validUntil || null,
    };

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    setSaving(false);

    if (!res.ok) {
      showToast("error", `Failed to save quote: ${data.error || "Unknown error"}`);
      return;
    }

    const quoteNumber = data.quote_number ?? data.quote?.quote_number;
    showToast("success", `Quote ${quoteNumber} ${status === "draft" ? "saved as draft" : "saved and marked as sent"}`);
    setTimeout(() => router.push("/app/quotes"), 800);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Header
        title="New Quote"
        description="Build a quote for a lead — line items, tax, and totals"
      />

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg transition-all",
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          )}
        >
          {toast.type === "success" ? <CheckCircle className="size-4" /> : <X className="size-4" />}
          {toast.message}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Back button */}
          <button
            onClick={() => router.push("/app/quotes")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to Quotes
          </button>

          {/* ── Lead selector ──────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Lead
              </p>
            </div>
            <div className="px-5 py-4">
              {selectedLead ? (
                <div className="flex items-center justify-between rounded-lg border border-border/60 bg-foreground/[0.02] px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {selectedLead.customer_name ?? "Unknown"}
                    </p>
                    {selectedLead.company_name && (
                      <p className="text-xs text-muted-foreground">{selectedLead.company_name}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setSelectedLead(null); setLeadId(""); setLeadSearch(""); }}
                    className="text-muted-foreground/60 hover:text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search by name or company..."
                    value={leadSearch}
                    onChange={(e) => { setLeadSearch(e.target.value); setShowLeadDropdown(true); }}
                    onFocus={() => setShowLeadDropdown(true)}
                    onBlur={() => setTimeout(() => setShowLeadDropdown(false), 150)}
                    className="h-9 text-sm"
                  />
                  {showLeadDropdown && leadOptions.length > 0 && (
                    <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border/60 bg-background shadow-lg">
                      {leadOptions.map((lead) => (
                        <button
                          key={lead.id}
                          className="flex w-full flex-col items-start px-4 py-2.5 text-left text-sm transition-colors hover:bg-foreground/[0.04]"
                          onMouseDown={() => {
                            setSelectedLead(lead);
                            setLeadId(lead.id);
                            setLeadSearch("");
                            setShowLeadDropdown(false);
                          }}
                        >
                          <span className="font-medium text-foreground">
                            {lead.customer_name ?? "Unknown"}
                          </span>
                          {lead.company_name && (
                            <span className="text-xs text-muted-foreground">{lead.company_name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {showLeadDropdown && leadSearch.trim() && leadOptions.length === 0 && (
                    <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground shadow-lg">
                      No leads found for &ldquo;{leadSearch}&rdquo;
                    </div>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground/60">
                Optional — associate this quote with an existing lead.
              </p>
            </div>
          </div>

          {/* ── Line items ─────────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Line Items
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={addLineItem}
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Add row
              </Button>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_100px_100px_36px] gap-2 border-b border-border/40 bg-foreground/[0.01] px-5 py-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Description</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Qty</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Unit Price</span>
              <span className="text-right text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Amount</span>
              <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/30">
              {lineItems.map((item, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_80px_100px_100px_36px] items-center gap-2 px-5 py-3"
                >
                  <ProductPickerInput
                    placeholder="e.g. Basmati Rice 25kg bag"
                    value={item.description}
                    productId={item.product_id ?? null}
                    onDescriptionChange={(text) => updateLineItem(index, "description", text)}
                    onSelectProduct={(product) => selectProductForLine(index, product)}
                    onClearProduct={() => clearProductForLine(index)}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.qty === 0 ? "" : item.qty}
                    onChange={(e) => updateLineItem(index, "qty", e.target.value)}
                    className="h-8 text-right text-sm tabular-nums"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price === 0 ? "" : item.unit_price}
                    onChange={(e) => updateLineItem(index, "unit_price", e.target.value)}
                    className="h-8 text-right text-sm tabular-nums"
                  />
                  <div className="text-right text-sm font-medium tabular-nums text-foreground/80">
                    {formatCurrency(item.amount, currency)}
                  </div>
                  <button
                    onClick={() => removeLineItem(index)}
                    disabled={lineItems.length === 1}
                    className="flex items-center justify-center text-muted-foreground/40 transition-colors hover:text-red-500 disabled:opacity-20"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Totals block */}
            <div className="border-t border-border/60 bg-foreground/[0.01] px-5 py-4">
              <div className="ml-auto max-w-xs space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(totals.subtotal, currency)}
                  </span>
                </div>

                {/* Tax rate field */}
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-sm text-muted-foreground">Tax rate (%)</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                    className="h-7 w-20 text-right text-sm tabular-nums"
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(totals.tax_amount, currency)}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
                  <span className="text-foreground">Total</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(totals.total, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Details ────────────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div className="border-b border-border/40 px-5 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Details
              </p>
            </div>
            <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
              {/* Currency */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Currency</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCurrency(c)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                        currency === c
                          ? "border-foreground/30 bg-foreground/[0.06] text-foreground"
                          : "border-border/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Valid until */}
              <div className="space-y-2">
                <Label htmlFor="valid-until" className="text-xs font-medium text-muted-foreground">
                  Valid Until
                </Label>
                <Input
                  id="valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes" className="text-xs font-medium text-muted-foreground">
                  Notes
                </Label>
                <textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment terms, delivery notes, special instructions..."
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            </div>
          </div>

          {/* ── Preview pill ───────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-foreground/[0.01] px-4 py-3 text-xs text-muted-foreground">
            <ReceiptText className="size-3.5 shrink-0" />
            <span>
              {lineItems.filter((i) => i.description.trim()).length} line item
              {lineItems.filter((i) => i.description.trim()).length !== 1 ? "s" : ""}
              {" · "}
              Total {formatCurrency(totals.total, currency)}
              {" · "}
            </span>
            <Badge className={cn("border-0 text-[10px] font-bold uppercase tracking-wider", statusBadgeClass("draft"))}>
              draft
            </Badge>
          </div>

          {/* ── Action buttons ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between pb-8">
            <button
              onClick={() => router.push("/app/quotes")}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleSave("draft")}
                className="h-9 gap-1.5"
              >
                <CheckCircle className="size-3.5" />
                {saving ? "Saving..." : "Save as Draft"}
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => handleSave("sent")}
                className="h-9 gap-1.5 bg-foreground text-background hover:bg-foreground/90"
              >
                <Send className="size-3.5" />
                {saving ? "Saving..." : "Save & Send"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
