"use client";

/**
 * /onboarding/setup — 4-step setup wizard (Direction C: Warm & Trustworthy)
 *
 * Step 1: Business confirmation ("You're almost in")
 * Step 2: WhatsApp QR scan (polls /api/status every 3s)
 * Step 3: Quick brand DNA (tone + top products + tagline)
 * Step 4: Celebration / go live
 *
 * URL param: ?tenant=<uuid>
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Progress indicator ────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ProgressSteps({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div
            className="size-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300"
            style={
              n < current
                ? { background: '#4a7c59', color: 'white' }
                : n === current
                ? { background: '#c87941', color: 'white' }
                : { background: '#f0e8df', color: '#b8a898' }
            }
          >
            {n < current ? <CheckIcon className="size-3.5" /> : n}
          </div>
          {n < total && (
            <div
              className="h-px flex-1 min-w-4 transition-all duration-500"
              style={{ background: n < current ? '#4a7c59' : '#ede5d8', width: '32px' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = "sm" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "size-5" : "size-8";
  return (
    <div
      className={`${cls} rounded-full border-2 border-t-transparent animate-spin`}
      style={{ borderColor: '#c87941', borderTopColor: 'transparent' }}
    />
  );
}

// ─── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-8 w-full max-w-lg mx-auto"
      style={{ background: 'white', border: '1px solid #ede5d8', boxShadow: '0 4px 24px rgba(28,22,18,0.06)' }}
    >
      {children}
    </div>
  );
}

// ─── Setup wizard inner ────────────────────────────────────────────────────────

function SetupWizardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant") ?? "";

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 2 — WhatsApp polling
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<string>("disconnected");
  const [waPolling, setWaPolling] = useState(false);

  // Step 3 — Quick brand DNA
  const [tone, setTone] = useState<"professional" | "friendly" | "mix">("mix");
  const [topProducts, setTopProducts] = useState("");
  const [tagline, setTagline] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  // Tenant info (loaded once)
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantEmail, setTenantEmail] = useState<string>("");

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/status`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.tenant?.name)  setTenantName(d.tenant.name);
        if (d?.tenant?.email) setTenantEmail(d.tenant.email);
      })
      .catch(() => {});
  }, [tenantId]);

  // Step 2: Poll /api/status for QR
  const pollWhatsApp = useCallback(() => {
    if (waStatus === "connected" || waStatus === "ready") return;

    setWaPolling(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => {
        setWaStatus(d.status ?? "disconnected");
        setQrCode(d.qr ?? null);

        if (d.status === "connected" || d.status === "ready") {
          setWaPolling(false);
          setTimeout(() => setStep(3), 1500);
        }
      })
      .catch(() => {})
      .finally(() => setWaPolling(false));
  }, [waStatus]);

  useEffect(() => {
    if (step !== 2) return;
    pollWhatsApp();
    const interval = setInterval(pollWhatsApp, 3000);
    return () => clearInterval(interval);
  }, [step, pollWhatsApp]);

  // Step 3: Save brand DNA
  async function saveBrandDna() {
    setBrandSaving(true);
    setBrandError(null);

    const productLines = topProducts
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const productCatalog = productLines.map((name) => ({
      product_name: name,
      unit: "unit",
      price: 0,
    }));

    const toneNotes =
      tone === "professional"
        ? "Formal and professional. Concise. Addresses customers respectfully."
        : tone === "friendly"
        ? "Warm and conversational. Friendly tone. Uses first names."
        : "Balanced mix of professional and friendly. Warm but businesslike.";

    try {
      const res = await fetch("/api/brand-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          tone_notes: toneNotes,
          product_catalog: productCatalog,
          tagline: tagline.trim() || null,
        }),
      });

      if (!res.ok) {
        console.warn("[Setup]: Brand DNA save returned non-OK:", res.status);
      }

      setStep(4);
    } catch {
      setStep(4);
    } finally {
      setBrandSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid #ede5d8',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#1c1612',
    width: '100%',
    outline: 'none',
    background: '#faf8f5',
  };

  // ── Step 1 — Confirmation ────────────────────────────────────────────────────
  const Step1 = () => (
    <Card>
      <ProgressSteps current={1} total={TOTAL_STEPS} />

      <div className="flex flex-col items-center text-center gap-5">
        <div
          className="size-14 rounded-2xl flex items-center justify-center"
          style={{ background: '#fdf3e7' }}
        >
          <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="#c87941" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: '#1c1612' }}>
            You&apos;re almost in
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#7a6a5a' }}>
            {tenantName ? (
              <>
                <span className="font-semibold" style={{ color: '#1c1612' }}>{tenantName}</span> has been registered.
              </>
            ) : (
              "Your account has been created."
            )}
            {tenantEmail && (
              <> We&apos;ll keep updates at{' '}
                <span style={{ color: '#c87941' }}>{tenantEmail}</span>.
              </>
            )}
          </p>
        </div>

        <div className="w-full rounded-xl p-5 text-left" style={{ background: '#faf8f5', border: '1px solid #ede5d8' }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#b8a898' }}>What&apos;s next</p>
          <ol className="space-y-3 text-sm">
            {[
              { n: 2, label: "Connect your WhatsApp" },
              { n: 3, label: "Tell the AI about your business" },
              { n: 4, label: "Go live — leads triaged automatically" },
            ].map(item => (
              <li key={item.n} className="flex items-center gap-3">
                <span
                  className="size-5 rounded-full text-xs font-semibold flex items-center justify-center shrink-0"
                  style={{ background: '#fdf3e7', color: '#c87941' }}
                >
                  {item.n}
                </span>
                <span style={{ color: '#7a6a5a' }}>{item.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <button
          onClick={() => setStep(2)}
          className="w-full rounded-xl py-3.5 px-4 text-base font-semibold text-white transition-all"
          style={{ background: '#c87941' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#b36a35')}
          onMouseLeave={e => (e.currentTarget.style.background = '#c87941')}
        >
          Next: Connect WhatsApp →
        </button>
      </div>
    </Card>
  );

  // ── Step 2 — WhatsApp QR ─────────────────────────────────────────────────────
  const Step2 = () => {
    const isConnected = waStatus === "connected" || waStatus === "ready";
    return (
      <Card>
        <ProgressSteps current={2} total={TOTAL_STEPS} />

        <div className="flex flex-col items-center gap-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-1.5" style={{ color: '#1c1612' }}>Connect your WhatsApp</h2>
            <p className="text-sm" style={{ color: '#7a6a5a' }}>
              Scan this QR code on your phone to link your WhatsApp account.
            </p>
          </div>

          {/* QR display */}
          <div
            className="size-56 sm:size-64 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{ border: '2px solid #ede5d8', background: 'white', padding: '8px' }}
          >
            {qrCode ? (
              <img
                src={`data:image/png;base64,${qrCode}`}
                alt="WhatsApp QR Code"
                className="w-full h-full object-contain rounded-xl"
              />
            ) : isConnected ? (
              <div className="flex flex-col items-center gap-2">
                <div className="size-12 rounded-full flex items-center justify-center" style={{ background: '#eef7f1' }}>
                  <CheckIcon className="size-6 text-green-600" />
                </div>
                <p className="text-sm font-medium" style={{ color: '#4a7c59' }}>Connected!</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Spinner size="md" />
                <p className="text-xs text-center px-4" style={{ color: '#b8a898' }}>
                  Starting WhatsApp connection…
                </p>
              </div>
            )}
          </div>

          {/* Status */}
          {!isConnected && qrCode && (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#7a6a5a' }}>
              <Spinner size="sm" />
              <span>Waiting for scan…</span>
            </div>
          )}

          {isConnected && (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#4a7c59' }}>
              <CheckIcon className="size-4" />
              <span>WhatsApp connected!</span>
            </div>
          )}

          {/* Instructions */}
          <div className="w-full rounded-xl p-5" style={{ background: '#faf8f5', border: '1px solid #ede5d8' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#b8a898' }}>How to scan</p>
            <ol className="space-y-2 text-sm">
              {[
                "Open WhatsApp on your phone",
                "Tap ⋮ (Android) or Settings (iPhone)",
                "Tap Linked Devices",
                "Tap Link a Device",
                "Point your camera at the QR code above",
              ].map((instruction, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="shrink-0 mt-0.5 size-4 rounded-full text-[10px] font-semibold flex items-center justify-center"
                    style={{ background: '#fdf3e7', color: '#c87941' }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: '#7a6a5a' }}>{instruction}</span>
                </li>
              ))}
            </ol>
          </div>

          <button
            onClick={() => setStep(3)}
            className="text-sm transition-colors underline underline-offset-2"
            style={{ color: '#b8a898' }}
          >
            Skip for now →
          </button>
        </div>
      </Card>
    );
  };

  // ── Step 3 — Quick brand DNA ─────────────────────────────────────────────────
  const Step3 = () => (
    <Card>
      <ProgressSteps current={3} total={TOTAL_STEPS} />

      <h2 className="text-2xl font-bold mb-1" style={{ color: '#1c1612' }}>Tell us about your business</h2>
      <p className="text-sm mb-6" style={{ color: '#7a6a5a' }}>
        This teaches the AI your voice so it drafts replies the way you would.
      </p>

      <div className="flex flex-col gap-5">
        {/* Tone */}
        <div>
          <p className="text-sm font-semibold mb-2" style={{ color: '#1c1612' }}>Communication tone</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "professional", label: "Professional" },
                { value: "friendly",     label: "Friendly" },
                { value: "mix",          label: "Mix" },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm cursor-pointer transition-all"
                style={
                  tone === opt.value
                    ? { border: '1.5px solid #c87941', background: '#fdf3e7', color: '#c87941' }
                    : { border: '1px solid #ede5d8', background: 'white', color: '#7a6a5a' }
                }
              >
                <input
                  type="radio"
                  name="tone"
                  value={opt.value}
                  checked={tone === opt.value}
                  onChange={() => setTone(opt.value)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Top products */}
        <div>
          <label className="block text-sm font-semibold mb-1" style={{ color: '#1c1612' }}>
            Top products you sell
          </label>
          <p className="text-xs mb-2" style={{ color: '#b8a898' }}>One per line</p>
          <textarea
            rows={4}
            dir="auto"
            value={topProducts}
            onChange={(e) => setTopProducts(e.target.value)}
            placeholder={"Rice\nSugar\nFlour\nCooking oil"}
            style={{ ...inputStyle, resize: 'none', lineHeight: '1.6' }}
          />
        </div>

        {/* Tagline */}
        <div>
          <label className="block text-sm font-semibold mb-1" style={{ color: '#1c1612' }}>
            Company tagline{' '}
            <span style={{ color: '#b8a898', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            dir="auto"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Quality wholesale since 1985"
            style={inputStyle}
          />
        </div>

        {brandError && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ border: '1px solid #fdecea', background: '#fff5f5', color: '#c0392b' }}>
            {brandError}
          </div>
        )}

        <button
          onClick={saveBrandDna}
          disabled={brandSaving}
          className="w-full rounded-xl py-3.5 px-4 text-base font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: '#c87941' }}
          onMouseEnter={e => { if (!brandSaving) e.currentTarget.style.background = '#b36a35'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#c87941'; }}
        >
          {brandSaving ? "Saving…" : "Save & Continue →"}
        </button>

        <button
          onClick={() => setStep(4)}
          className="text-sm transition-colors underline underline-offset-2 text-center"
          style={{ color: '#b8a898' }}
        >
          Skip for now →
        </button>
      </div>
    </Card>
  );

  // ── Step 4 — Celebration ─────────────────────────────────────────────────────
  const Step4 = () => (
    <Card>
      <ProgressSteps current={4} total={TOTAL_STEPS} />

      <div className="flex flex-col items-center text-center gap-5">
        {/* Animated checkmark */}
        <div
          className="size-20 rounded-full flex items-center justify-center"
          style={{ background: '#eef7f1', border: '2px solid #4a7c59' }}
        >
          <style>{`
            @keyframes drawCheck {
              from { stroke-dashoffset: 60; opacity: 0; }
              to   { stroke-dashoffset: 0;  opacity: 1; }
            }
            .animated-check {
              stroke-dasharray: 60;
              stroke-dashoffset: 60;
              animation: drawCheck 0.6s ease-out 0.2s forwards;
            }
          `}</style>
          <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="#4a7c59" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path className="animated-check" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: '#1c1612' }}>You&apos;re all set!</h2>
          <p className="text-sm leading-relaxed max-w-sm" style={{ color: '#7a6a5a' }}>
            Your Sales OS is active. Leads coming in via WhatsApp will now be
            automatically triaged and draft replies generated for you to approve.
          </p>
        </div>

        {/* What was set up */}
        <div className="w-full rounded-xl p-5 text-left" style={{ background: '#faf8f5', border: '1px solid #ede5d8' }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#b8a898' }}>What&apos;s been set up</p>
          <ul className="space-y-2 text-sm">
            {[
              "Inbound WhatsApp messages are scored for purchase intent",
              "HIGH priority leads get an AI-drafted reply within seconds",
              "You approve, edit, or dismiss before anything is sent",
              "The AI learns from your edits to improve over time",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="#4a7c59" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span style={{ color: '#7a6a5a' }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full flex flex-col gap-3">
          <a
            href="/app/dashboard"
            className="w-full rounded-xl py-3.5 px-4 text-base font-semibold text-white transition-all text-center"
            style={{ background: '#c87941' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#b36a35')}
            onMouseLeave={e => (e.currentTarget.style.background = '#c87941')}
          >
            Go to dashboard →
          </a>
          <a
            href="/app/leads"
            className="w-full rounded-xl py-3.5 px-4 text-base font-medium transition-all text-center"
            style={{ border: '1px solid #ede5d8', color: '#7a6a5a', background: 'white' }}
          >
            View leads
          </a>
        </div>
      </div>
    </Card>
  );

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col px-4 py-10 sm:py-16"
      style={{ background: '#faf8f5' }}
    >
      {/* Header */}
      <div className="mb-8 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="size-8 rounded-xl flex items-center justify-center font-bold text-white text-sm"
              style={{ background: '#c87941' }}
            >
              IS
            </div>
            <span className="font-semibold text-sm" style={{ color: '#1c1612' }}>Invisible Sales OS</span>
          </div>
          <span className="text-xs" style={{ color: '#b8a898' }}>
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
      </div>

      {/* Step card */}
      <div className="flex-1 flex items-start justify-center">
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        {step === 4 && <Step4 />}
      </div>
    </div>
  );
}

// ─── Page export (Suspense boundary for useSearchParams) ──────────────────────

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#faf8f5' }}>
          <div
            className="size-8 rounded-full border-2 animate-spin"
            style={{ borderColor: '#c87941', borderTopColor: 'transparent' }}
          />
        </div>
      }
    >
      <SetupWizardInner />
    </Suspense>
  );
}
