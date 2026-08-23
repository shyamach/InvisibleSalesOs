/**
 * /api/billing/current — Server-side proxy to GET /api/billing/current on Express.
 * Forwards the caller's Authorization header — the backend route requires it
 * (requireAuth, since the Phase B requireInternalKey -> requireAuth migration)
 * to resolve which tenant's billing to return. x-internal-key alone, as this
 * route previously sent, does not satisfy requireAuth and always 401s.
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");

    const res = await fetch(`${BACKEND_URL}/api/billing/current`, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        "x-internal-key": INTERNAL_API_KEY,
      },
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
