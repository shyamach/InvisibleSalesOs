"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

// ─── Google icon ─────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// ─── Microsoft icon ───────────────────────────────────────────────────────────

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#00A4EF" d="M13 1h10v10H13z" />
      <path fill="#7FBA00" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.push("/app/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Goes through /auth/callback (a server route) rather than straight
        // to /app/dashboard — that page is gated by middleware.ts, which
        // checks the session cookie server-side before the client-side SDK
        // ever gets a chance to exchange the ?code=... param for a real
        // session. Landing there directly meant the middleware saw no
        // session yet and bounced straight back to /login, silently
        // wasting the one-time code — OAuth looked like it just didn't
        // respond. The callback route does the exchange server-side first.
        redirectTo: `${window.location.origin}/auth/callback?next=/app/dashboard`,
        // Without this, Google silently signs in with whichever Google
        // account is already active in the browser — no chooser, no
        // chance to pick a different account. select_account forces the
        // picker every time, even with one active session.
        queryParams: { prompt: "select_account" },
      },
    });
    if (oauthError) { setError(oauthError.message); setLoading(false); }
  }

  async function handleMicrosoftLogin() {
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/app/dashboard`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (oauthError) { setError(oauthError.message); setLoading(false); }
  }

  const inputBase =
    "w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors placeholder:text-[#b8a898]";

  return (
    <div className="flex min-h-screen">

      {/* ── Left — branding panel ─────────────────────────────────────── */}
      <div
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "#1c1612" }}
      >
        {/* Warm radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 30% 60%, rgba(200,121,65,0.07) 0%, transparent 65%)",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "#c87941" }}
          >
            IS
          </div>
          <div>
            <p className="text-sm font-medium text-white">Invisible Sales OS</p>
            <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "#6a5a4a" }}>
              Revenue Intelligence
            </p>
          </div>
        </div>

        {/* Copy */}
        <div className="relative space-y-5">
          <h1
            className="max-w-md text-3xl font-semibold leading-tight"
            style={{ color: "#fdf3e7", letterSpacing: "-0.02em" }}
          >
            Your WhatsApp inbox.<br />
            <span style={{ color: "#c87941" }}>A full sales team.</span>
          </h1>
          <p className="max-w-sm text-sm leading-relaxed" style={{ color: "#7a6a5a" }}>
            AI-triage every message, draft every reply, generate every quote and invoice —
            automatically. Built for South Asian wholesale businesses in the UK.
          </p>

          {/* Stats */}
          <div className="flex gap-8 pt-4">
            {[
              { value: "Live", label: "Built & Working" },
              { value: "Early Access", label: "Founding Clients Now" },
              { value: "Quotes", label: "Straight To Invoice" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-semibold" style={{ color: "#fdf3e7" }}>
                  {stat.value}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.15em]" style={{ color: "#4a3a2a" }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs" style={{ color: "#3a2a1a" }}>
          © 2026 Invisible Sales OS. All rights reserved.
        </p>
      </div>

      {/* ── Right — login form ────────────────────────────────────────── */}
      <div
        className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2"
        style={{ background: "#faf8f5" }}
      >
        <div className="w-full max-w-sm space-y-8">

          {/* Mobile-only logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <div
              className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: "#c87941" }}
            >
              IS
            </div>
            <span className="text-sm font-semibold" style={{ color: "#1c1612" }}>
              Invisible Sales OS
            </span>
          </div>

          {/* Header */}
          <div className="space-y-1">
            <h2 className="text-xl font-semibold" style={{ color: "#1c1612" }}>
              Welcome back
            </h2>
            <p className="text-sm" style={{ color: "#7a6a5a" }}>
              Sign in to your Sales OS workspace
            </p>
          </div>

          {/* OAuth buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white disabled:opacity-60"
              style={{ borderColor: "#ede5d8", color: "#1c1612", background: "#ffffff" }}
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white disabled:opacity-60"
              style={{ borderColor: "#ede5d8", color: "#1c1612", background: "#ffffff" }}
            >
              <MicrosoftIcon />
              Continue with Microsoft
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t" style={{ borderColor: "#ede5d8" }} />
            <span className="text-xs" style={{ color: "#b8a898" }}>or sign in with email</span>
            <div className="flex-1 border-t" style={{ borderColor: "#ede5d8" }} />
          </div>

          {/* Email / password form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-medium" style={{ color: "#7a6a5a" }}>
                Email address
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2"
                  style={{ color: "#b8a898" }}
                  strokeWidth={1.5}
                />
                <input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputBase + " pl-10"}
                  style={{
                    border: "1px solid #ede5d8",
                    color: "#1c1612",
                    background: "#ffffff",
                  }}
                  onFocus={(e) => (e.currentTarget.style.boxShadow = "0 0 0 2px #c87941")}
                  onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-medium" style={{ color: "#7a6a5a" }}>
                Password
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2"
                  style={{ color: "#b8a898" }}
                  strokeWidth={1.5}
                />
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputBase + " pl-10"}
                  style={{
                    border: "1px solid #ede5d8",
                    color: "#1c1612",
                    background: "#ffffff",
                  }}
                  onFocus={(e) => (e.currentTarget.style.boxShadow = "0 0 0 2px #c87941")}
                  onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs" style={{ color: "#c0392b" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "#c87941" }}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Footer links */}
          <div className="space-y-3">
            <p className="text-center text-xs" style={{ color: "#b8a898" }}>
              By continuing, you agree to our{" "}
              <span className="underline underline-offset-2 cursor-pointer">Terms of Service</span>{" "}
              and{" "}
              <span className="underline underline-offset-2 cursor-pointer">Privacy Policy</span>.
            </p>
            <p className="text-center text-sm" style={{ color: "#7a6a5a" }}>
              No account yet?{" "}
              <a
                href="/signup"
                className="font-medium underline underline-offset-2"
                style={{ color: "#c87941" }}
              >
                Start your free trial
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
