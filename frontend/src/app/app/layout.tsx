"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/components/layout/sidebar";
import { registerPushSubscription, isPushSupported } from "@/lib/push";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [showPushBanner, setShowPushBanner] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
      } else {
        setChecking(false);

        // Attempt silent push registration on subsequent visits
        // (if permission was already granted, this is a no-op from the user's perspective)
        if (isPushSupported()) {
          if (Notification.permission === 'granted') {
            // Already permitted — register silently
            registerPushSubscription().catch(console.warn);
          } else if (Notification.permission === 'default') {
            // Not yet asked — show the banner so the user can opt in
            setShowPushBanner(true);
          }
          // 'denied' — don't pester the user
        }
      }
    });
  }, [router]);

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
