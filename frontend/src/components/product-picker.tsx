"use client";

/**
 * product-picker.tsx — Debounced catalogue search + select, for a single
 * quote/invoice line item. Mirrors the lead-search autocomplete pattern
 * already used on quotes/new (search input → dropdown → select), scoped to
 * one row instead of a whole form.
 *
 * Deliberately description-only: line items can be freeform (job-work,
 * custom services — see controllers/invoices.js's stock-deduction comment),
 * so typing plain text without picking anything is always valid. Selecting
 * a result just fills in product_id + prefills description/unit_price for
 * the caller to apply however its own line-item shape needs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Input } from "@/components/ui/input";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  currency: string;
  stock_quantity: number;
}

interface ProductPickerInputProps {
  value: string;
  productId: string | null;
  placeholder?: string;
  onDescriptionChange: (text: string) => void;
  onSelectProduct: (product: ProductOption) => void;
  onClearProduct: () => void;
  className?: string;
}

export function ProductPickerInput({
  value,
  productId,
  placeholder,
  onDescriptionChange,
  onSelectProduct,
  onClearProduct,
  className,
}: ProductPickerInputProps) {
  const { getAuthHeaders } = useAuth();
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const requestId = useRef(0);

  const fetchProducts = useCallback(async (query: string) => {
    if (!query.trim()) {
      setOptions([]);
      return;
    }
    const thisRequest = ++requestId.current;
    const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=8`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (thisRequest !== requestId.current) return; // stale response, a newer keystroke already fired
    setOptions(json.products ?? []);
  }, [getAuthHeaders]);

  useEffect(() => {
    // No point re-searching once a product is already linked — the field is
    // just being edited as text at that point.
    if (productId) return;
    const timer = setTimeout(() => fetchProducts(value), 200);
    return () => clearTimeout(timer);
  }, [value, productId, fetchProducts]);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => { onDescriptionChange(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          className={cn("h-8 text-sm", productId && "pr-7")}
        />
        {productId && (
          <button
            type="button"
            title="Linked to catalogue product — click to unlink"
            onMouseDown={(e) => { e.preventDefault(); onClearProduct(); }}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-emerald-600 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-emerald-400 dark:hover:bg-red-950/40"
          >
            <Link2 className="size-3.5" />
          </button>
        )}
      </div>

      {showDropdown && !productId && options.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border/60 bg-background shadow-lg">
          {options.map((product) => (
            <button
              key={product.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/[0.04]"
              onMouseDown={() => {
                onSelectProduct(product);
                setShowDropdown(false);
              }}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {product.sku ? `${product.sku} · ` : ""}
                  Stock: {product.stock_quantity}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {product.currency} {product.price.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}

      {showDropdown && !productId && value.trim() && options.length === 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-xs text-muted-foreground shadow-lg">
          No catalogue matches for &ldquo;{value}&rdquo; — using as freeform text.
        </div>
      )}
    </div>
  );
}
