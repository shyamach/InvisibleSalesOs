import Link from "next/link";
import {
  MessageSquare,
  PenLine,
  FileText,
  Receipt,
  Bell,
  BarChart2,
} from "lucide-react";

// ─── Features ────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: MessageSquare,
    title: "WhatsApp AI Triage",
    description:
      "Every message scored for buying intent the moment it arrives. No more guessing who's serious.",
  },
  {
    icon: PenLine,
    title: "Auto-Draft Replies",
    description:
      "AI writes the perfect response in your voice. You approve in one tap — or edit and send.",
  },
  {
    icon: FileText,
    title: "Quote Builder",
    description:
      "Turn a WhatsApp order enquiry into a professional quote in seconds, not hours.",
  },
  {
    icon: Receipt,
    title: "Invoice Generation",
    description:
      "Quotes accepted? Invoice sent automatically. No chasing, no missed payments.",
  },
  {
    icon: Bell,
    title: "Follow-Up Engine",
    description:
      "Leads that go quiet get a nudge at the right time. Your pipeline keeps moving.",
  },
  {
    icon: BarChart2,
    title: "Weekly Digest",
    description:
      "Every Monday: leads converted, revenue generated, top buyers. Know your numbers cold.",
  },
];

// ─── Pricing teaser ──────────────────────────────────────────────────────────

const PLANS_TEASER = [
  {
    name: "Starter",
    price: "£49",
    period: "/mo",
    description: "For solo operators getting started with AI.",
    highlighted: false,
    badge: null,
  },
  {
    name: "Growth",
    price: "£149",
    period: "/mo",
    description: "For distributors who can't miss a lead.",
    highlighted: true,
    badge: "Most Popular",
  },
  {
    name: "Enterprise",
    price: "£399",
    period: "/mo",
    description: "Multi-line operations with custom AI identity.",
    highlighted: false,
    badge: null,
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ background: "#faf8f5", color: "#1c1612" }}>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section
        style={{ background: "#1c1612", minHeight: "90vh" }}
        className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-24 text-center"
      >
        {/* Warm radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(200,121,65,0.08) 0%, transparent 70%)",
          }}
        />

        {/* Nav */}
        <nav className="absolute left-0 right-0 top-0 flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-2">
            <div
              className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: "#c87941" }}
            >
              IS
            </div>
            <span className="text-sm font-medium text-white">Invisible Sales OS</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm" style={{ color: "#8a7060" }}>
              Pricing
            </Link>
            <Link href="/login" className="text-sm" style={{ color: "#8a7060" }}>
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "#c87941" }}
            >
              Get started
            </Link>
          </div>
        </nav>

        {/* Badge */}
        <div
          className="relative mb-6 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest"
          style={{ background: "rgba(200,121,65,0.15)", color: "#c87941" }}
        >
          Built for South Asian wholesale businesses
        </div>

        {/* Headline */}
        <h1
          className="relative max-w-3xl text-4xl font-semibold leading-tight md:text-6xl"
          style={{ color: "#fdf3e7", letterSpacing: "-0.02em" }}
        >
          Your WhatsApp inbox.<br />
          <span style={{ color: "#c87941" }}>Turned into a sales machine.</span>
        </h1>

        {/* Sub-headline */}
        <p
          className="relative mt-6 max-w-xl text-lg"
          style={{ color: "#8a7060", lineHeight: 1.7 }}
        >
          Every message scored. Every buyer followed up. Quotes and invoices in seconds.
          Your business runs — you just approve.
        </p>

        {/* CTA row */}
        <div className="relative mt-10 flex items-center gap-4">
          <Link
            href="/signup"
            className="rounded-xl px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "#c87941" }}
          >
            Start free trial — no card needed
          </Link>
          <a href="#how-it-works" className="text-sm" style={{ color: "#8a7060" }}>
            See how it works →
          </a>
        </div>

        {/* Social proof line */}
        <p className="relative mt-8 text-xs" style={{ color: "#6a5a4a" }}>
          14-day free trial · No setup fee · Works with your existing WhatsApp
        </p>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="px-6 py-24" style={{ background: "#faf8f5" }}>
        <div className="mx-auto max-w-4xl">
          <p
            className="mb-3 text-center text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#c87941" }}
          >
            How it works
          </p>
          <h2
            className="mb-16 text-center text-3xl font-semibold"
            style={{ color: "#1c1612", letterSpacing: "-0.01em" }}
          >
            Up and running in under 5 minutes
          </h2>

          <div className="grid gap-10 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Connect your WhatsApp",
                description:
                  "Scan a QR code inside the dashboard. Takes 2 minutes. No new number — your existing WhatsApp, unchanged.",
              },
              {
                step: "2",
                title: "AI reads every message",
                description:
                  "Every enquiry is automatically scored for buying intent. Hot leads surface instantly so you never miss a sale.",
              },
              {
                step: "3",
                title: "Approve and send",
                description:
                  "AI drafts the perfect reply, quote, or invoice. You review and tap send. Your customers get a faster, more professional response.",
              },
            ].map(({ step, title, description }) => (
              <div key={step} className="flex flex-col items-start gap-4">
                <div
                  className="flex size-10 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "#c87941" }}
                >
                  {step}
                </div>
                <h3 className="text-base font-semibold" style={{ color: "#1c1612" }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#7a6a5a" }}>
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ────────────────────────────────────────────────── */}
      <section className="px-6 py-24" style={{ background: "#fdf3e7" }}>
        <div className="mx-auto max-w-5xl">
          <p
            className="mb-3 text-center text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#c87941" }}
          >
            Features
          </p>
          <h2
            className="mb-16 text-center text-3xl font-semibold"
            style={{ color: "#1c1612", letterSpacing: "-0.01em" }}
          >
            Everything you need, nothing you don&apos;t
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex flex-col gap-4 rounded-2xl border p-6"
                style={{ background: "#ffffff", borderColor: "#ede5d8" }}
              >
                <div
                  className="flex size-10 items-center justify-center rounded-lg"
                  style={{ background: "#fdf3e7" }}
                >
                  <Icon className="size-5" style={{ color: "#c87941" }} strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold" style={{ color: "#1c1612" }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#7a6a5a" }}>
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING TEASER ───────────────────────────────────────────────── */}
      <section className="px-6 py-24" style={{ background: "#faf8f5" }}>
        <div className="mx-auto max-w-5xl">
          <p
            className="mb-3 text-center text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#c87941" }}
          >
            Pricing
          </p>
          <h2
            className="mb-4 text-center text-3xl font-semibold"
            style={{ color: "#1c1612", letterSpacing: "-0.01em" }}
          >
            Simple, transparent pricing
          </h2>
          <p className="mb-16 text-center text-sm" style={{ color: "#7a6a5a" }}>
            14-day free trial on every plan. No credit card required.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {PLANS_TEASER.map((plan) => (
              <div
                key={plan.name}
                className="relative flex flex-col rounded-2xl border p-8"
                style={{
                  background: plan.highlighted ? "#ffffff" : "#ffffff",
                  borderColor: plan.highlighted ? "#c87941" : "#ede5d8",
                  boxShadow: plan.highlighted
                    ? "0 0 0 2px #c87941, 0 8px 32px -8px rgba(200,121,65,0.18)"
                    : undefined,
                }}
              >
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span
                      className="rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-wider text-white"
                      style={{ background: "#c87941" }}
                    >
                      {plan.badge}
                    </span>
                  </div>
                )}

                <h3 className="mb-1 text-base font-semibold" style={{ color: "#1c1612" }}>
                  {plan.name}
                </h3>
                <p className="mb-6 text-sm" style={{ color: "#7a6a5a" }}>
                  {plan.description}
                </p>

                <div className="mb-8">
                  <span className="text-4xl font-bold" style={{ color: "#1c1612" }}>
                    {plan.price}
                  </span>
                  <span className="ml-1 text-sm" style={{ color: "#b8a898" }}>
                    {plan.period}
                  </span>
                </div>

                <Link
                  href="/pricing"
                  className="block rounded-xl py-3 text-center text-sm font-semibold transition-opacity hover:opacity-80"
                  style={
                    plan.highlighted
                      ? { background: "#c87941", color: "#ffffff" }
                      : { background: "#fdf3e7", color: "#c87941" }
                  }
                >
                  See full plan →
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-sm" style={{ color: "#b8a898" }}>
            Need a custom deal?{" "}
            <a href="https://wa.me/447700900000" className="underline" style={{ color: "#c87941" }}>
              WhatsApp us directly
            </a>
          </p>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer style={{ background: "#1c1612" }} className="px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div
                className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: "#c87941" }}
              >
                IS
              </div>
              <div>
                <p className="text-sm font-medium text-white">Invisible Sales OS</p>
                <p className="text-xs" style={{ color: "#6a5a4a" }}>
                  Built for Lala businesses
                </p>
              </div>
            </div>

            {/* Nav links */}
            <div className="flex flex-wrap gap-6 text-sm" style={{ color: "#6a5a4a" }}>
              <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
              <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
              <Link href="/signup" className="hover:text-white transition-colors">Get started</Link>
            </div>
          </div>

          <div
            className="mt-8 border-t pt-8 text-xs"
            style={{ borderColor: "#2e2420", color: "#4a3a2a" }}
          >
            © {new Date().getFullYear()} Invisible Sales OS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
