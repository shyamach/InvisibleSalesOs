"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Sidebar } from "@/components/layout/sidebar";
import { registerPushSubscription, isPushSupported } from "@/lib/push";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading, onboardingRequired } = useAuth();
  const [showPushBanner, setShowPushBanner] = useState(false);
  const pushChecked = useRef(false);

  useEffect(() => {
    if (loading) return; // AuthProvider hasn't resolved the session yet

    if (!session) {
      router.replace("/login");
      return;
    }

    // A session alone isn't enough to be here — every route under /app/*
    // requires req.tenantId. The email/password signup flow always
    // provisions a tenant before ever reaching /app/*, but OAuth sign-in
    // (Google/Microsoft via /login) only creates the auth user and has no
    // equivalent step — it used to land straight here with no tenant, and
    // every backend call then failed (2026-08-21 finding). Anyone who
    // reaches this gate without one gets sent to complete their profile and
    // provision a tenant, exactly like signup already does. onboardingRequired
    // comes from AuthProvider's own /api/proxy/auth/me call — not refetched
    // here, so there's exactly one call per session change, not two.
    if (onboardingRequired) {
      router.replace("/onboarding/complete-profile");
      return;
    }

    // Attempt silent push registration on subsequent visits (once per
    // resolved session, not on every re-render — if permission was already
    // granted, this is a no-op from the user's perspective).
    if (!pushChecked.current && isPushSupported()) {
      pushChecked.current = true;
      if (Notification.permission === 'granted') {
        registerPushSubscription().catch(console.warn);
      } else if (Notification.permission === 'default') {
        setShowPushBanner(true);
      }
      // 'denied' — don't pester the user
    }
  }, [loading, session, onboardingRequired, router]);

  const checking = loading || !session || onboardingRequired;

  const handleEnableNotifications = async () => {
    setShowPushBanner(false);
    try {
      await registerPushSubscription();
    } catch (err) {
      console.warn('[Push]: Registration failed:', err);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Authenticating...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Push notification permission banner */}
      {showPushBanner && (
        <div className="flex items-center justify-between gap-4 border-b border-amber-800/40 bg-amber-950/30 px-4 py-2 text-sm text-amber-300">
          <span>Get notified when HIGH priority leads arrive</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleEnableNotifications}
              className="rounded bg-amber-700/50 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-700/70 transition-colors"
            >
              Enable notifications
            </button>
            <button
              onClick={() => setShowPushBanner(false)}
              className="rounded px-3 py-1 text-xs text-amber-400/70 hover:text-amber-300 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
