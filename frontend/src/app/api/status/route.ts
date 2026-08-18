/**
 * /api/status — Next.js API route.
 *
 * Proxies to the Express backend's /api/status endpoint.
 * The next.config.mjs rewrites already handle this for browser fetches,
 * but this explicit route ensures SSR and middleware paths also work.
 *
 * Returns: { status: "disconnected" | "awaiting_scan" | "connected", qr?: string }
 *
 * Forwards the caller's session (if any) as a Bearer token so the backend
 * can decide whether to include the WhatsApp pairing `qr` field — that field
 * is sensitive (scanning it links a new device) and the backend now omits
 * it for unauthenticated callers (2026-08-18 audit fix A6). Reads the
 * session from cookies server-side, same mechanism as middleware.ts, since
 * this route itself isn't behind the auth middleware (it's legitimately
 * polled from the pre-login onboarding wizard too).
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
