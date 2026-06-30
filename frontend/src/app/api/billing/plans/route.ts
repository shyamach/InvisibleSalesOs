/**
 * /api/billing/plans — Public proxy to GET /api/billing/plans on Express.
 * No authentication required — pricing is public information.
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/billing/plans`, {
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
