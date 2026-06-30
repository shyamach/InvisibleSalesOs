/**
 * /api/billing/current — Server-side proxy to GET /api/billing/current on Express.
 * Attaches x-internal-key — never exposed to the browser.
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function GET() {
  try {
    if (!INTERNAL_API_KEY) {
      return NextResponse.json(
        { success: false, error: "INTERNAL_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const res = await fetch(`${BACKEND_URL}/api/billing/current`, {
      headers: { "x-internal-key": INTERNAL_API_KEY },
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Backend unavailable: ${message}` },
      { status: 503 }
    );
  }
}
