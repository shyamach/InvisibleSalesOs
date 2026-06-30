/**
 * /api/status — Next.js API route.
 *
 * Proxies to the Express backend's /api/status endpoint.
 * The next.config.mjs rewrites already handle this for browser fetches,
 * but this explicit route ensures SSR and middleware paths also work.
 *
 * Returns: { status: "disconnected" | "awaiting_scan" | "connected", qr?: string }
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3001";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/status`, {
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
