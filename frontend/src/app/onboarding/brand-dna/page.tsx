"use client";

/**
 * Brand DNA Wizard — 3-step onboarding to teach the AI your voice.
 * Step 1: Business identity + tone
 * Step 2: Product catalog
 * Step 3: AI voice preview + save
 * On complete → UPSERT brand_dna → redirect to /app/dashboard
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Sparkles,
  Building2,
  Package,
  Mic,
} from "lucide-react";

// 2026-08-18 audit fix (Phase B item B2): this page previously instantiated
// its own throwaway anon-key Supabase client and upserted brand_dna with a
// hardcoded default-tenant literal ("Lane C") — reachable fully logged-out,
// since this page also isn't covered by middleware.ts's /app/:path* matcher.
// The 3-step wizard here collects more fields (business_name,
// language_preference, reply_languages, successful_examples) than the
// narrower POST /api/brand-dna quick-save route (fixed the same day)
// supports, so rather than force-fit it into that schema, this page now
// uses the shared, session-authenticated singleton client directly and
// resolves the real tenant from the caller's own user_tenants membership —
// "add real session-based auth" was already the accepted alternative to a
// backend endpoint for Lane C pages per this project's own prior decision.

// ─── Types ────────────────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu" },
  { value: "pa", label: "Punjabi" },
  { value: "hi", label: "Hindi" },
  { value: "gu", label: "Gujarati" },
  { value: "ar", label: "Arabic" },
  { value: "mixed", label: "Mixed" },
] as const;

const UNIT_OPTIONS = ["metre", "kg", "box", "unit", "roll"] as const;

interface ProductRow {
  id: string;
  product_name: string;
  unit: string;
  price: string;
}

// ─── Sample AI draft ──────────────────────────────────────────────────────────

const SAMPLE_DRAFT =
  "Ji Ahmed bhai, thank you for reaching out. We have 200 metres of georgette in white available at £4.50/metre. Payment terms: 30 days net. Let me know if you'd like a formal quote.";

// ─── Progress indicator ───────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center gap-3">
          <div
            className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-all ${
              step < current
                ? "bg-foreground text-background"
                : step === current
                ? "border-2 border-foreground text-foreground"
                : "border border-border/60 text-muted-foreground"
            }`}
          >
            {step < current ? <CheckCircle className="size-3.5" strokeWidth={2.5} /> : step}
          </div>
          {step < total && (
            <div
              className={`h-px w-8 transition-all ${
                step < current ? "bg-foreground/60" : "bg-border/60"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const STEP_LABELS = ["Business Identity", "Product Catalog", "AI Voice Preview"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BrandDnaPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 state
  const [businessName, setBusinessName] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("en");
  const [replyLanguages, setReplyLanguages] = useState<string[]>(["en"]);
  const [toneNotes, setToneNotes] = useState("");

  // Step 2 state
  const [products, setProducts] = useState<ProductRow[]>([
    { id: crypto.randomUUID(), product_name: "", unit: "metre", price: "" },
  ]);

  // Step 3 state
  const [sampleDraft, setSampleDraft] = useState(SAMPLE_DRAFT);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleReplyLanguage(value: string) {
    setReplyLanguages((prev) =>
      prev.includes(value) ? prev.filter((l) => l !== value) : [...prev, value]
    );
  }

  function addProduct() {
    setProducts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), product_name: "", unit: "metre", price: "" },
    ]);
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function updateProduct(id: string, field: keyof Omit<ProductRow, "id">, value: string) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function handleNext() {
    setError(null);
    if (step === 1 && !businessName.trim()) {
      setError("Please enter your business name.");
      return;
    }
    setStep((s) => s + 1);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const productCatalog = products
      .filter((p) => p.product_name.trim())
      .map((p) => ({
        product_name: p.product_name.trim(),
        unit: p.unit,
        price: parseFloat(p.price) || 0,
      }));

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session has expired — please sign in again.");
      setSaving(false);
      return;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("user_tenants")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership?.tenant_id) {
      setError("Could not resolve your account's business — please sign in again.");
      setSaving(false);
      return;
    }

    const { error: upsertError } = await supabase.from("brand_dna").upsert(
      {
        tenant_id: membership.tenant_id,
        brand_name: businessName.trim(),
        language_preference: primaryLanguage,
        reply_languages: replyLanguages,
        tone_notes: toneNotes.trim() || null,
        product_catalog: productCatalog,
        successful_examples: [{ draft: sampleDraft, edited: sampleDraft !== SAMPLE_DRAFT }],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" }
    );

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    router.push("/app/dashboard");
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border/60 px-6 py-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md border border-border/80 bg-foreground/5">
              <Sparkles className="size-4 text-foreground/80" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Invisible Sales OS</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Onboarding
              </p>
            </div>
          </div>
          <StepIndicator current={step} total={3} />
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-2xl space-y-8">

          {/* Step heading */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Step {step} of 3
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {STEP_LABELS[step - 1]}
            </h1>
          </div>

          <Separator className="opacity-60" />

          {/* ── Step 1: Business Identity ─────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Business name */}
              <div className="space-y-2">
                <Label htmlFor="business-name" className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="size-3.5 text-muted-foreground" />
                  Business Name
                </Label>
                <Input
                  id="business-name"
                  placeholder="e.g. Ahmed Fabrics Ltd"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="h-10"
                />
              </div>

              {/* Primary language */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Primary Language</Label>
                <p className="text-xs text-muted-foreground">
                  The main language your customers communicate in
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <button
                      key={lang.value}
                      type="button"
                      onClick={() => setPrimaryLanguage(lang.value)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        primaryLanguage === lang.value
                          ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reply languages */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Reply Languages</Label>
                <p className="text-xs text-muted-foreground">
                  Languages the AI should use when drafting replies (select all that apply)
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {LANGUAGE_OPTIONS.map((lang) => {
                    const checked = replyLanguages.includes(lang.value);
                    return (
                      <button
                        key={lang.value}
                        type="button"
                        onClick={() => toggleReplyLanguage(lang.value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          checked
                            ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        <div
                          className={`size-3.5 rounded-sm border transition-colors ${
                            checked
                              ? "border-foreground bg-foreground"
                              : "border-border/60"
                          }`}
                        >
                          {checked && (
                            <CheckCircle className="size-3.5 text-background" strokeWidth={3} />
                          )}
                        </div>
                        {lang.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tone notes */}
              <div className="space-y-2">
                <Label htmlFor="tone-notes" className="text-sm font-medium">
                  Communication Style
                </Label>
                <p className="text-xs text-muted-foreground">
                  Describe how you communicate with customers — the AI will match your style
                </p>
                <textarea
                  id="tone-notes"
                  rows={4}
                  value={toneNotes}
                  onChange={(e) => setToneNotes(e.target.value)}
                  placeholder='e.g. Formal but warm. Always uses "Ji" as a respectful suffix. Mentions payment terms upfront. Gives prices per metre. Signs off with "Jazak Allah Khair".'
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Product Catalog ───────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Your Products</p>
                  <p className="text-xs text-muted-foreground">
                    The AI will reference these when drafting price enquiry replies
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addProduct}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  Add product
                </Button>
              </div>

              <div className="space-y-2">
                {/* Header row */}
                <div className="grid grid-cols-12 gap-2 px-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <div className="col-span-5">Product Name</div>
                  <div className="col-span-3">Unit</div>
                  <div className="col-span-3">Price (£)</div>
                  <div className="col-span-1" />
                </div>

                {products.map((product) => (
                  <div key={product.id} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-5">
                      <Input
                        placeholder="e.g. Georgette fabric"
                        value={product.product_name}
                        onChange={(e) =>
                          updateProduct(product.id, "product_name", e.target.value)
                        }
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        value={product.unit}
                        onChange={(e) => updateProduct(product.id, "unit", e.target.value)}
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="4.50"
                        value={product.price}
                        onChange={(e) => updateProduct(product.id, "price", e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => removeProduct(product.id)}
                        disabled={products.length === 1}
                        className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-20"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {products.filter((p) => p.product_name.trim()).length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 py-8 text-center">
                  <Package className="mx-auto size-8 text-muted-foreground/30" strokeWidth={1.5} />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add at least one product so the AI knows what you sell
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: AI Voice Preview ──────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border/60 bg-card/50 p-5 ring-1 ring-border/40">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  <Mic className="size-3.5" />
                  This is how your AI will sound
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Based on your brand DNA — edit the sample below to fine-tune the AI&apos;s voice
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Sample AI Reply</Label>
                <textarea
                  rows={6}
                  value={sampleDraft}
                  onChange={(e) => setSampleDraft(e.target.value)}
                  className="w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
                />
                <p className="text-xs text-muted-foreground">
                  This example will be saved as a reference for the AI when generating future replies.
                </p>
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-border/50 bg-foreground/[0.02] px-5 py-4 space-y-3">
                <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  Your Brand DNA
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Business</p>
                    <p className="font-medium text-foreground">{businessName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Primary language</p>
                    <p className="font-medium text-foreground">
                      {LANGUAGE_OPTIONS.find((l) => l.value === primaryLanguage)?.label}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Reply languages</p>
                    <p className="font-medium text-foreground">
                      {replyLanguages
                        .map((l) => LANGUAGE_OPTIONS.find((o) => o.value === l)?.label)
                        .join(", ")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Products</p>
                    <p className="font-medium text-foreground">
                      {products.filter((p) => p.product_name.trim()).length} items
                    </p>
                  </div>
                </div>
                {toneNotes && (
                  <div>
                    <p className="text-xs text-muted-foreground">Tone notes</p>
                    <p className="mt-0.5 text-sm text-foreground/80">{toneNotes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
              {error}
            </div>
          )}

          <Separator className="opacity-60" />

          {/* Navigation buttons */}
          <div className="flex items-center justify-between">
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={() => { setError(null); setStep((s) => s - 1); }}
                className="gap-1.5"
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>
            ) : (
              <div />
            )}

            {step < 3 ? (
              <Button onClick={handleNext} className="gap-1.5">
                Continue
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSave}
                disabled={saving}
                className="gap-1.5 bg-foreground text-background hover:bg-foreground/90"
              >
                <CheckCircle className="size-4" />
                {saving ? "Saving..." : "Save & Activate"}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
