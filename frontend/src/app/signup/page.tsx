"use client";

/**
 * /signup — Public sign-up page.
 * Mobile-first. Collects business details, creates Supabase auth user,
 * then calls /api/proxy/auth/register to provision the tenant.
 * On success: redirects to /onboarding/setup
 */

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  business_name: string;
  owner_name: string;
  owner_email: string;
  whatsapp_number: string;
  country: string;
  business_type: string;
  password: string;
  confirm_password: string;
}

interface FieldError {
  business_name?: string;
  owner_name?: string;
  owner_email?: string;
  whatsapp_number?: string;
  password?: string;
  confirm_password?: string;
}

const INITIAL_FORM: FormState = {
  business_name: "",
  owner_name: "",
  owner_email: "",
  whatsapp_number: "",
  country: "UK",
  business_type: "Wholesale",
  password: "",
  confirm_password: "",
};

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

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(form: FormState): FieldError {
  const errors: FieldError = {};
  if (!form.business_name.trim()) errors.business_name = "Business name is required.";
  if (!form.owner_name.trim()) errors.owner_name = "Your name is required.";
  if (!form.owner_email.trim()) {
    errors.owner_email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email.trim())) {
    errors.owner_email = "Enter a valid email address.";
  }
  if (!form.whatsapp_number.trim()) {
    errors.whatsapp_number = "WhatsApp number is required.";
  } else if (!/^\+\d{7,15}$/.test(form.whatsapp_number.trim().replace(/\s/g, ""))) {
    errors.whatsapp_number = "Include country code, e.g. +44 7700 000000";
  }
  if (!form.password) {
    errors.password = "Password is required.";
  } else if (form.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }
  if (!form.confirm_password) {
    errors.confirm_password = "Please confirm your password.";
  } else if (form.password !== form.confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }
  return errors;
}

// ─── Field component ──────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: "#7a6a5a" }}>
        {label}
      </label>
      {children}
      {error && (
        <p className="text-xs" style={{ color: "#c0392b" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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

    setSubmitting(true);
    // Tracks whether step 1 below has already created a live auth account —
    // once true, any later failure must not strand the user on a dead-end
    // error, since retrying signup will just say "already registered."
    let accountCreated = false;

    try {
      // Step 1: Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.owner_email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: { full_name: form.owner_name.trim() },
        },
      });

      if (authError) {
        if (authError.message.toLowerCase().includes("already registered")) {
          setFieldErrors({ owner_email: "An account with this email already exists." });
        } else {
          setServerError(authError.message ?? "Sign-up failed. Please try again.");
        }
        return;
      }

      accountCreated = true;
      const token = authData.session?.access_token;

      // Step 2: Provision tenant in backend
      const res = await fetch("/api/proxy/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          owner_name: form.owner_name.trim(),
          owner_email: form.owner_email.trim().toLowerCase(),
          whatsapp_number: form.whatsapp_number.trim().replace(/\s/g, ""),
          country: form.country,
          business_type: form.business_type,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setFieldErrors({ owner_email: "An account with this email already exists." });
          return;
        }
        throw new Error(data?.error || "Tenant provisioning failed");
      }

      // Success — redirect to setup wizard
      router.push("/onboarding/setup");
    } catch {
      if (accountCreated) {
        // The auth account already exists at this point — send them through
        // the same tenant-less recovery flow OAuth sign-ins use instead of a
        // dead-end error (AppLayout's redirect guard / onboarding/complete-profile).
        router.push("/onboarding/complete-profile");
      } else {
        setServerError("Could not connect to the server. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center px-4 py-12 sm:py-20"
      style={{ background: "#faf8f5" }}
    >
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-5">
            <div
              className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: "#c87941" }}
            >
              IS
            </div>
            <span className="font-semibold text-base" style={{ color: "#1c1612" }}>
              Invisible Sales OS
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-snug" style={{ color: "#1c1612", letterSpacing: "-0.02em" }}>
            Start your free trial
          </h1>
          <p className="mt-2 text-sm" style={{ color: "#7a6a5a" }}>
            14 days free, no card required
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border px-6 py-8 sm:px-8"
          style={{
            background: "#ffffff",
            borderColor: "#ede5d8",
            boxShadow: "0 4px 24px -4px rgba(28,22,18,0.08)",
          }}
        >
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

            {/* Business name */}
            <Field label="Business name" error={fieldErrors.business_name}>
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
            </Field>

            {/* Your name */}
            <Field label="Your name" error={fieldErrors.owner_name}>
              <input
                type="text"
                dir="auto"
                autoComplete="name"
                placeholder="e.g. Imran Ahmed"
                value={form.owner_name}
                onChange={set("owner_name")}
                className={inputClass(fieldErrors.owner_name)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.owner_name)}
              />
            </Field>

            {/* Email */}
            <Field label="Email address" error={fieldErrors.owner_email}>
              <input
                type="email"
                dir="auto"
                autoComplete="email"
                placeholder="you@yourbusiness.com"
                value={form.owner_email}
                onChange={set("owner_email")}
                className={inputClass(fieldErrors.owner_email)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.owner_email)}
              />
            </Field>

            {/* Password */}
            <Field label="Password" error={fieldErrors.password}>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={set("password")}
                className={inputClass(fieldErrors.password)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.password)}
              />
            </Field>

            {/* Confirm password */}
            <Field label="Confirm password" error={fieldErrors.confirm_password}>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={form.confirm_password}
                onChange={set("confirm_password")}
                className={inputClass(fieldErrors.confirm_password)}
                style={{ color: "#1c1612", background: "#ffffff" }}
                onFocus={applyFocusRing}
                onBlur={(e) => removeFocusRing(e, fieldErrors.confirm_password)}
              />
            </Field>

            {/* WhatsApp */}
            <Field label="WhatsApp number" error={fieldErrors.whatsapp_number}>
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
            </Field>

            {/* Business type + Country (side by side) */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Business type">
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
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                    style={{ color: "#b8a898" }}
                  >
                    ▾
                  </span>
                </div>
              </Field>

              <Field label="Country">
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
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                    style={{ color: "#b8a898" }}
                  >
                    ▾
                  </span>
                </div>
              </Field>
            </div>

            {/* Server error */}
            {serverError && (
              <div
                className="rounded-lg border px-4 py-3 text-sm"
                style={{
                  borderColor: "#c0392b",
                  background: "rgba(192,57,43,0.06)",
                  color: "#c0392b",
                }}
              >
                {serverError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-xl py-3.5 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#c87941" }}
            >
              {submitting ? "Creating your account…" : "Get started free →"}
            </button>
          </form>
        </div>

        {/* Trust strip */}
        <p className="mt-5 text-center text-xs" style={{ color: "#b8a898" }}>
          Your data is private · No spam · Cancel anytime
        </p>

        {/* Sign-in link */}
        <p className="mt-3 text-center text-sm" style={{ color: "#7a6a5a" }}>
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium underline underline-offset-2"
            style={{ color: "#c87941" }}
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
