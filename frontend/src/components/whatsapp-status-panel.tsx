"use client";

/**
 * WhatsAppStatusPanel — real per-tenant connection status + QR, replacing
 * the concierge-only "we connect this for you" panel that both
 * /app/integrations and /onboarding/setup had (explicitly commented as
 * temporary "until per-tenant session isolation exists (2026-08-23)").
 * That isolation shipped the next day (lib/whatsappSessions.js) with a
 * per-tenant GET /api/status endpoint already built for exactly this UI —
 * it just never got a caller after the concierge swap. Found 2026-08-25
 * while investigating a user report of a confusing, disconnected manual
 * QR-scan attempt with no way to see real status anywhere in the app.
 *
 * Polls GET /api/status (already tenant-scoped, cookie-authenticated —
 * see frontend/src/app/api/status/route.ts) every few seconds. The first
 * poll for a brand-new tenant triggers session creation server-side
 * (getOrCreateSession), so "disconnected" on load is expected and
 * transient — it should progress to awaiting_scan (with a QR) within a
 * few seconds. If it stays disconnected for too long, that's genuinely
 * ambiguous with the backend being unreachable (the Next.js proxy route
 * also reports "disconnected" on a fetch failure or timeout), so this
 * shows a different, honest message after enough failed attempts rather
 * than an indefinite "preparing" spinner.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import QRCode from "react-qr-code";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

type WhatsAppStatus = "disconnected" | "awaiting_scan" | "connected";

interface StatusResponse {
  status: WhatsAppStatus;
  qr?: string | null;
  phoneNumber?: string | null;
}

const POLL_MS = 3000;
const STALL_THRESHOLD = 6; // ~18s of consecutive "disconnected" before treating it as a real problem, not just startup

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-foreground/[0.02] px-6 py-10">
      {children}
    </div>
  );
}

export function WhatsAppStatusPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const disconnectedStreak = useRef(0);
  const [stalled, setStalled] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const json: StatusResponse = await res.json();
      setData(json);

      if (json.status === "disconnected") {
        disconnectedStreak.current += 1;
        if (disconnectedStreak.current >= STALL_THRESHOLD) setStalled(true);
      } else {
        disconnectedStreak.current = 0;
        setStalled(false);
      }
    } catch {
      disconnectedStreak.current += 1;
      if (disconnectedStreak.current >= STALL_THRESHOLD) setStalled(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (!data) {
    return (
      <PanelShell>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Checking connection…</p>
      </PanelShell>
    );
  }

  if (data.status === "connected") {
    return (
      <PanelShell>
        <div className="flex size-12 items-center justify-center rounded-full border border-emerald-500/30 bg-background">
          <CheckCircle2 className="size-5 text-emerald-600" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="mt-4 text-center text-sm font-medium text-foreground/80">Connected</p>
        {data.phoneNumber && (
          <p className="mt-1 text-center text-xs text-muted-foreground">+{data.phoneNumber}</p>
        )}
      </PanelShell>
    );
  }

  if (data.status === "awaiting_scan" && data.qr) {
    return (
      <PanelShell>
        <div className="rounded-lg bg-white p-3">
          <QRCode value={data.qr} size={180} />
        </div>
        <p className="mt-4 text-center text-sm font-medium text-foreground/80">Scan to connect</p>
        <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
          Open WhatsApp on your phone → Settings → Linked Devices → Link a
          Device, then scan this code.
        </p>
      </PanelShell>
    );
  }

  if (stalled) {
    return (
      <PanelShell>
        <div className="flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-background">
          <AlertCircle className="size-5 text-amber-600" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="mt-4 text-center text-sm font-medium text-foreground/80">
          Taking longer than expected
        </p>
        <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
          Try refreshing the page. If this keeps happening, message us and
          we&apos;ll take a look.
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="mt-3 text-center text-sm font-medium text-foreground/80">
        Preparing connection…
      </p>
      <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
        This can take a few seconds the first time.
      </p>
    </PanelShell>
  );
}
