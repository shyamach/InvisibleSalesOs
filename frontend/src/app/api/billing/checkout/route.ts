/**
 * /api/billing/checkout — Server-side proxy to POST /api/billing/create-checkout.
 * Attaches x-internal-key — never exposed to the browser.
 *
 * Request body: { plan_id: string }
 * Response: { success: boolean, message: string, redirect_url: string }
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body?.plan_id) {
      return NextResponse.json(
        { success: false, error: "Missing plan_id" },
        { status: 400 }
      );
    }

    if (!INTERNAL_API_KEY) {
      return NextResponse.json(
        { success: false, error: "INTERNAL_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const res = await fetch(`${BACKEND_URL}/api/billing/create-checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ plan_id: body.plan_id }),
      signal: AbortSignal.timeout(10000),
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
