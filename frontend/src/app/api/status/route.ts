/**
 * /api/status — Next.js API route.
 *
 * Proxies to the Express backend's /api/status endpoint.
 * The next.config.mjs rewrites already handle this for browser fetches,
 * but this explicit route ensures SSR and middleware paths also work.
 *
 * Returns: { status: "disconnected" | "awaiting_scan" | "connected", qr?: string }
 *
 * Forwards the caller's session (if any) as a Bearer token — the backend
 * now requires a real, tenant-resolved session for every call (2026-08-23
 * fix: it used to accept any authenticated caller and return whichever
 * tenant's session happened to be live, a cross-tenant leak; now it 401s
 * without a valid token and returns only the calling tenant's own status/qr,
 * per-tenant session isolation in lib/whatsappSessions.js). Nothing calls
 * this route pre-login any more either — onboarding's self-serve QR step
 * was replaced with a concierge message the same day. Still reads the
 * session from cookies server-side (same mechanism as middleware.ts) rather
 * than sitting behind this app's own auth middleware, and still degrades to
 * "disconnected" on any failure below, so an unauthenticated or backend-down
 * caller gets a harmless default instead of an error page.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3001";

export async function GET() {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() { /* read-only here — no response to attach refreshed cookies to */ },
        },
      }
    );
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${BACKEND_URL}/api/status`, {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
      // Short timeout — if the backend is offline we want to fail fast
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return NextResponse.json({ status: "disconnected" }, { status: 200 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Express backend is offline — return disconnected gracefully
    return NextResponse.json({ status: "disconnected" }, { status: 200 });
  }
}
