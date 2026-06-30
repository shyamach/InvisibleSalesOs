"use client";

/**
 * /pricing — Public pricing page. No authentication required.
 *
 * Shows the three Invisible Sales OS plans, a feature comparison table,
 * FAQ, and trust signals. Designed to convert a Lala business owner who
 * is price-sensitive but ROI-driven.
 *
 * Direction C — Warm & Trustworthy palette.
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

// ─── Plan data (mirrors controllers/billing.js) ───────────────────────────────

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 49,
    annualPrice: 41,
    description: "Perfect for a single operator who wants AI on their side.",
    highlighted: false,
    badge: null,
    cta: "Start free trial",
    ctaHref: "/signup",
    features: [
      "Every WhatsApp message scored for buying intent — automatically",
      "500 AI-triaged leads per month",
      "1 WhatsApp number connected",
      "Quote and invoice generation in seconds",
      "Email inbox scanning for inbound enquiries",
      "1 team member",
      "Standard email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 149,
    annualPrice: 124,
    description: "For growing distributors who can't afford to miss a lead.",
    highlighted: true,
    badge: "Most Popular",
    cta: "Start free trial",
    ctaHref: "/signup",
    features: [
      "Everything in Starter",
      "Unlimited AI-triaged leads — no monthly cap",
      "3 WhatsApp numbers connected",
      "Call logging with auto-summary",
      "Automated follow-up engine — chases leads so you don't have to",
      "Customer segments for targeted outreach",
      "3 team members",
      "Priority support (same-day response)",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 399,
    annualPrice: 332,
    description: "For multi-line distributors who need their own AI identity.",
    highlighted: false,
    badge: null,
    cta: "Talk to us",
    ctaHref: "https://wa.me/447700900000",
    features: [
      "Everything in Growth",
      "Unlimited WhatsApp numbers and team members",
      "Custom Brand DNA per product line — AI learns your exact voice",
      "Full API access for custom integrations",
      "White-label — your logo, your domain",
      "Dedicated onboarding specialist",
      "Custom SLA and compliance reporting",
    ],
  },
];

// ─── Comparison table ─────────────────────────────────────────────────────────

const COMPARISON = [
  { feature: "AI lead triage (buying intent score)", starter: true, growth: true, enterprise: true },
  { feature: "WhatsApp numbers", starter: "1", growth: "3", enterprise: "Unlimited" },
  { feature: "AI leads per month", starter: "500", growth: "Unlimited", enterprise: "Unlimited" },
  { feature: "Quote + invoice generation", starter: true, growth: true, enterprise: true },
  { feature: "Email inbox scanning", starter: true, growth: true, enterprise: true },
  { feature: "Call logging + auto-summary", starter: false, growth: true, enterprise: true },
  { feature: "Automated follow-up engine", starter: false, growth: true, enterprise: true },
  { feature: "Customer segments", starter: false, growth: true, enterprise: true },
  { feature: "Team members", starter: "1", growth: "3", enterprise: "Unlimited" },
  { feature: "Brand DNA per product line", starter: false, growth: false, enterprise: true },
  { feature: "API access", starter: false, growth: false, enterprise: true },
  { feature: "White-label", starter: false, growth: false, enterprise: true },
  { feature: "Dedicated onboarding", starter: false, growth: false, enterprise: true },
  { feature: "Support", starter: "Email", growth: "Priority (same-day)", enterprise: "Dedicated" },
];

const FAQS = [
  {
    q: "Does it work with my existing WhatsApp number?",
    a: "Yes. You connect your existing WhatsApp Business number — no new number required. Messages continue to arrive exactly as they do today, but Invisible Sales OS now reads them, scores them for buying intent, and drafts a reply for your review before you send anything.",
  },
  {
    q: "What happens if I go over my lead limit on Starter?",
    a: "You'll receive a notification when you're approaching 500 leads for the month. Additional leads in that period are queued and processed at the start of the next cycle. You can upgrade to Growth at any time to unlock unlimited lead triage with no interruption to your workflow.",
  },
  {
    q: "Is my business data secure and private?",
    a: "All data is encrypted in transit and at rest. Your customer conversations, quotes, and invoices belong to you — they are never used to train shared AI models, never sold, and never shared with third parties. We are GDPR compliant and can provide a Data Processing Agreement on request.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. Invisible Sales OS is fully browser-based. You log in, connect your WhatsApp number via QR code (takes under two minutes), and that's it. Nothing to install on your phone, no IT team needed.",
  },
  {
    q: "Can I get support in Urdu or Hindi?",
    a: "Yes. Our support team speaks Urdu, Hindi, and Punjabi. The AI itself already detects the language of incoming messages and can generate replies in Urdu, Hindi, English, or a natural code-switch between them — whichever matches how your customer writes.",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlanCheck() {
  return <CheckCircle2 className="size-4 shrink-0" style={{ color: "#c87941" }} strokeWidth={2} />;
}

function PlanCross() {
  return <X className="size-4 shrink-0" style={{ color: "#b8a898" }} strokeWidth={2} />;
}

function ComparisonCell({ value }: { value: boolean | string }) {
  if (value === true)
    return (
      <td className="py-3 px-4 text-center">
        <CheckCircle2 className="size-4 mx-auto" style={{ color: "#c87941" }} strokeWidth={2} />
      </td>
    );
  if (value === false)
    return (
      <td className="py-3 px-4 text-center">
        <X className="size-4 mx-auto" style={{ color: "#b8a898" }} strokeWidth={2} />
      </td>
    );
  return (
    <td className="py-3 px-4 text-center text-sm" style={{ color: "#7a6a5a" }}>
      {value}
    </td>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <div style={{ background: "#faf8f5", color: "#1c1612" }} className="min-h-screen">

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b backdrop-blur"
        style={{ background: "rgba(250,248,245,0.92)", borderColor: "#ede5d8" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex size-7 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ background: "#c87941" }}
            >
              IS
            </span>
            <span className="text-sm font-semibold" style={{ color: "#1c1612" }}>
              Invisible Sales OS
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-[#c87941] hover:text-[#c87941]"
            style={{ borderColor: "#ede5d8", color: "#7a6a5a" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden px-6 py-24 text-center"
        style={{ background: "#1c1612" }}
      >
        {/* Warm glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(200,121,65,0.08) 0%, transparent 70%)",
          }}
        />

        <p
          className="relative mb-4 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#c87941" }}
        >
          Pricing
        </p>
        <h1
          className="relative mx-auto max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl"
          style={{ color: "#fdf3e7", letterSpacing: "-0.02em" }}
        >
          Simple, transparent pricing
        </h1>
        <p className="relative mx-auto mt-5 max-w-xl text-lg" style={{ color: "#7a6a5a", lineHeight: 1.7 }}>
          Every WhatsApp message triaged. Every email lead captured. Every quote generated in seconds.
          Your competitors are still doing this by hand.
        </p>

        {/* Trust strip */}
        <div className="relative mt-10 flex flex-wrap items-center justify-center gap-6 text-sm" style={{ color: "#6a5a4a" }}>
          {["14-day free trial", "No credit card", "Cancel anytime", "GDPR compliant"].map((item) => (
            <span key={item} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: "#4a7c59" }} />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ── Annual toggle ─────────────────────────────────────────────────── */}
      <div className="flex justify-center pt-12 pb-2">
        <div
          className="inline-flex items-center gap-3 rounded-full border px-4 py-2"
          style={{ borderColor: "#ede5d8", background: "#ffffff" }}
        >
          <span className="text-sm" style={{ color: annual ? "#b8a898" : "#1c1612", fontWeight: annual ? 400 : 600 }}>
            Monthly
          </span>
          <button
            type="button"
            onClick={() => setAnnual((v) => !v)}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{ background: annual ? "#c87941" : "#ede5d8" }}
            aria-label="Toggle annual billing"
          >
            <span
              className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: annual ? "translateX(20px)" : "translateX(0)" }}
            />
          </button>
          <span className="text-sm" style={{ color: annual ? "#1c1612" : "#b8a898", fontWeight: annual ? 600 : 400 }}>
            Annual
          </span>
          {annual && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: "#fdf3e7", color: "#c87941" }}
            >
              2 months free
            </span>
          )}
        </div>
      </div>

      {/* ── Pricing cards ─────────────────────────────────────────────────── */}
      <section className="px-6 pb-24 pt-8">
        <div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-3 items-start">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="relative flex flex-col rounded-2xl border p-8 transition-all"
              style={{
                background: "#ffffff",
                borderColor: plan.highlighted ? "#c87941" : "#ede5d8",
                boxShadow: plan.highlighted
                  ? "0 0 0 2px #c87941, 0 8px 32px -8px rgba(200,121,65,0.2)"
                  : "0 2px 12px -4px rgba(28,22,18,0.06)",
                marginTop: plan.highlighted ? undefined : undefined,
              }}
            >
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span
                    className="rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow"
                    style={{ background: "#c87941" }}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="mb-5">
                <h2 className="text-base font-semibold" style={{ color: "#1c1612" }}>
                  {plan.name}
                </h2>
                <p className="mt-1 text-sm" style={{ color: "#7a6a5a" }}>
                  {plan.description}
                </p>
              </div>

              <div className="mb-8">
                <span className="text-5xl font-bold tracking-tight" style={{ color: "#1c1612" }}>
                  £{annual ? plan.annualPrice : plan.price}
                </span>
                <span className="ml-1.5 text-sm" style={{ color: "#b8a898" }}>/month</span>
                {annual && (
                  <p className="mt-1 text-xs" style={{ color: "#c87941" }}>
                    billed annually — save £{(plan.price - plan.annualPrice) * 12}/yr
                  </p>
                )}
                {!annual && (
                  <p className="mt-1 text-xs" style={{ color: "#b8a898" }}>billed monthly</p>
                )}
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: "#7a6a5a" }}>
                    <PlanCheck />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className="block rounded-xl py-3 text-center text-sm font-semibold transition-opacity hover:opacity-80"
                style={
                  plan.highlighted
                    ? { background: "#c87941", color: "#ffffff" }
                    : { background: "#fdf3e7", color: "#c87941" }
                }
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm" style={{ color: "#b8a898" }}>
          All plans start with a 14-day free trial. No credit card required until you subscribe.
        </p>
      </section>

      {/* ── Comparison table ──────────────────────────────────────────────── */}
      <section className="px-6 py-20" style={{ background: "#fdf3e7" }}>
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-2xl font-semibold" style={{ color: "#1c1612", letterSpacing: "-0.01em" }}>
            What&apos;s included — at a glance
          </h2>

          <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "#ede5d8" }}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#ede5d8", background: "#ffffff" }}>
                  <th className="py-4 px-4 text-xs font-semibold uppercase tracking-wider w-1/2" style={{ color: "#b8a898" }}>
                    Feature
                  </th>
                  <th className="py-4 px-4 text-center text-sm font-semibold" style={{ color: "#1c1612" }}>Starter</th>
                  <th className="py-4 px-4 text-center text-sm font-semibold" style={{ color: "#c87941" }}>Growth</th>
                  <th className="py-4 px-4 text-center text-sm font-semibold" style={{ color: "#1c1612" }}>Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className="border-b last:border-0"
                    style={{
                      borderColor: "#ede5d8",
                      background: i % 2 === 0 ? "#ffffff" : "#fdf3e7",
                    }}
                  >
                    <td className="py-3 px-4 text-sm" style={{ color: "#7a6a5a" }}>{row.feature}</td>
                    <ComparisonCell value={row.starter} />
                    <ComparisonCell value={row.growth} />
                    <ComparisonCell value={row.enterprise} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="px-6 py-20" style={{ background: "#faf8f5" }}>
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-12 text-center text-2xl font-semibold" style={{ color: "#1c1612", letterSpacing: "-0.01em" }}>
            Frequently asked questions
          </h2>

          <div className="space-y-8">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="border-b pb-8 last:border-0" style={{ borderColor: "#ede5d8" }}>
                <h3 className="mb-3 text-base font-semibold" style={{ color: "#1c1612" }}>
                  {q}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#7a6a5a" }}>
                  {a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section
        id="contact"
        className="relative overflow-hidden px-6 py-24 text-center"
        style={{ background: "#1c1612" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(200,121,65,0.07) 0%, transparent 70%)",
          }}
        />
        <h2
          className="relative mb-4 text-2xl font-semibold"
          style={{ color: "#fdf3e7", letterSpacing: "-0.01em" }}
        >
          Ready to stop leaving money on the table?
        </h2>
        <p className="relative mb-8 text-sm" style={{ color: "#7a6a5a" }}>
          Start your 14-day free trial today. No card required, cancel anytime.
        </p>
        <div className="relative flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-xl px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "#c87941" }}
          >
            Start free trial
          </Link>
          <a
            href="https://wa.me/447700900000"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border px-8 py-3 text-sm font-semibold transition-colors hover:border-[#c87941] hover:text-[#c87941]"
            style={{ borderColor: "#3a2a1a", color: "#7a6a5a" }}
          >
            WhatsApp us: +44 7700 900 000
          </a>
        </div>

        <div className="relative mt-10 flex flex-wrap items-center justify-center gap-6 text-xs" style={{ color: "#4a3a2a" }}>
          {["14-day free trial", "No credit card required", "Cancel anytime", "GDPR compliant"].map(
            (item) => <span key={item}>{item}</span>
          )}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer
        className="border-t px-6 py-8 text-center text-xs"
        style={{ borderColor: "#ede5d8", color: "#b8a898", background: "#faf8f5" }}
      >
        <p>© {new Date().getFullYear()} Invisible Sales OS. Built for Lala businesses across the UK.</p>
      </footer>
    </div>
  );
}
