"use client";

/**
 * /onboarding/complete-profile — Tenant provisioning for OAuth sign-ins.
 *
 * The email/password signup flow (/signup) does two steps: create the
 * Supabase auth user, then immediately POST /api/proxy/auth/register to
 * provision a tenant via bootstrap_tenant(). Google/Microsoft OAuth
 * (/login's "Continue with Google/Microsoft") only ever did the first half
 * — supabase.auth.signInWithOAuth() creates the auth user (Supabase's
 * default OAuth behavior on first login) and redirects straight into
 * /app/dashboard, with no tenant ever provisioned. Every backend route
 * requires req.tenantId, so that user landed on a permanently broken,
 * empty app with no path to recovery (2026-08-21 finding).
 *
 * This page is where AppLayout (frontend/src/app/app/layout.tsx) now sends
 * any authenticated user whose GET /api/proxy/auth/me comes back
 * `onboarding_required: true` — collects the same business details the
 * signup form does (minus password/email, already established via OAuth),
 * then calls the same POST /api/proxy/auth/register endpoint. No backend
 * changes were needed: registerWithAuth() already derives user identity
 * from the caller's JWT, not from how they authenticated.
 */

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

interface FormState {
  business_name: string;
  whatsapp_number: string;
  country: string;
  business_type: string;
}

interface FieldError {
  business_name?: string;
  whatsapp_number?: string;
}

const COUNTRIES = [
  { value: "UK", label: "United Kingdom" },
  { value: "UAE", label: "UAE" },
  { value: "PK", label: "Pakistan" },
  { value: "IN", label: "India" },
  { value: "ZA", label: "South Africa" },
  { value: "other", label: "Other" },
];

const BUSINESS_TYPES = [
  { value: "Wholesale", label: "Wholesale" },
  { value: "Distributor", label: "Distributor" },
  { value: "Retailer", label: "Retailer" },
  { value: "Other", label: "Other" },
];

function validate(form: FormState): FieldError {
  const errors: FieldError = {};
  if (!form.business_name.trim()) errors.business_name = "Business name is required.";
  if (!form.whatsapp_number.trim()) {
    errors.whatsapp_number = "WhatsApp number is required.";
  } else if (!/^\+\d{7,15}$/.test(form.whatsapp_number.trim().replace(/\s/g, ""))) {
    errors.whatsapp_number = "Include country code, e.g. +44 7700 000000";
  }
  return errors;
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { session, loading, user, tenant, getAuthHeaders } = useAuth();
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [form, setForm] = useState<FormState>({ business_name: "", whatsapp_number: "", country: "UK", business_type: "Wholesale" });
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;

    // No session at all — nothing to complete. Send them to log in first.
    if (!session || !user) {
      router.replace("/login");
      return;
    }

    // Already has a tenant (e.g. navigated here directly by URL after
    // already completing this once) — nothing to do, move on.
    if (tenant) {
      router.replace("/app/dashboard");
      return;
    }

    setOwnerName(user.user_metadata?.full_name || user.user_metadata?.name || "");
    setOwnerEmail(user.email || "");
  }, [loading, session, user, tenant, router]);

  const checkingSession = loading || !session || !user || !!tenant;

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  const inputClass = (hasError?: string) =>
    [
      "w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors",
      "placeholder:text-[#b8a898]",
      hasError ? "border-[#c0392b]" : "border-[#ede5d8] hover:border-[#c87941]/50",
    ].join(" ");

  const selectClass =
    "w-full rounded-lg border border-[#ede5d8] hover:border-[#c87941]/50 px-4 py-3 text-sm outline-none transition-colors appearance-none";

  function applyFocusRing(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
    e.currentTarget.style.boxShadow = "0 0 0 2px #c87941";
    e.currentTarget.style.borderColor = "#c87941";
  }
  function removeFocusRing(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>, hasError?: string) {
    e.currentTarget.style.boxShadow = "none";
    e.currentTarget.style.borderColor = hasError ? "#c0392b" : "#ede5d8";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!session) {
      router.replace("/login");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/proxy/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          owner_name: ownerName.trim() || ownerEmail,
          whatsapp_number: form.whatsapp_number.trim().replace(/\s/g, ""),
          country: form.country,
          business_type: form.business_type,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setServerError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.push(`/onboarding/setup?tenant=${data.tenant?.id ?? ""}`);
    } catch {
      setServerError("Could not connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#faf8f5" }}>
        <div className="size-8 rounded-full border-2 animate-spin" style={{ borderColor: "#c87941", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-12 sm:py-20" style={{ background: "#faf8f5" }}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-5">
            <div className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: "#c87941" }}>
              IS
            </div>
            <span className="font-semibold text-base" style={{ color: "#1c1612" }}>Invisible Sales OS</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-snug" style={{ color: "#1c1612", letterSpacing: "-0.02em" }}>
            One more step
          </h1>
          <p className="mt-2 text-sm" style={{ color: "#7a6a5a" }}>
            Tell us about your business to finish setting up{ownerEmail ? ` ${ownerEmail}` : ""}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border px-6 py-8 sm:px-8"
          style={{ background: "#ffffff", borderColor: "#ede5d8", boxShadow: "0 4px 24px -4px rgba(28,22,18,0.08)" }}
        >
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "#7a6a5a" }}>Business name</label>
              <input
                type="text"
                dir="auto"
                autoComplete="organization"
                placeholder="e.g. Ahmed Fabrics Ltd"
                value={form.business_name}
                onChange={set("business_name")}
                className={inputClass(fieldErrors.business_name)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.business_name)}
              />
              {fieldErrors.business_name && <p className="text-xs" style={{ color: "#c0392b" }}>{fieldErrors.business_name}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "#7a6a5a" }}>WhatsApp number</label>
              <input
                type="tel"
                dir="ltr"
                autoComplete="tel"
                placeholder="+44 7700 000000"
                value={form.whatsapp_number}
                onChange={set("whatsapp_number")}
                className={inputClass(fieldErrors.whatsapp_number)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.whatsapp_number)}
              />
              {fieldErrors.whatsapp_number && <p className="text-xs" style={{ color: "#c0392b" }}>{fieldErrors.whatsapp_number}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: "#7a6a5a" }}>Business type</label>
                <div className="relative">
                  <select
                    value={form.business_type}
                    onChange={set("business_type")}
                    className={selectClass}
                    style={{ color: "#1c1612", background: "#ffffff" }}
                    onFocus={applyFocusRing}
                    onBlur={(e) => removeFocusRing(e)}
                  >
                    {BUSINESS_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "#b8a898" }}>▾</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: "#7a6a5a" }}>Country</label>
                <div className="relative">
                  <select
                    value={form.country}
                    onChange={set("country")}
                    className={selectClass}
                    style={{ color: "#1c1612", background: "#ffffff" }}
                    onFocus={applyFocusRing}
                    onBlur={(e) => removeFocusRing(e)}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "#b8a898" }}>▾</span>
                </div>
              </div>
            </div>

            {serverError && (
              <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "#c0392b", background: "rgba(192,57,43,0.06)", color: "#c0392b" }}>
                {serverError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-xl py-3.5 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#c87941" }}
            >
              {submitting ? "Setting up your workspace…" : "Continue →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
