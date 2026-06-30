/**
 * /api/dispatch — Server-side proxy to Express dispatch endpoint.
 *
 * Keeps INTERNAL_API_KEY server-side only (never exposed to browser).
 * Called by the Drafts approval UI when user clicks "Approve & Send" or "Save & Send".
 *
 * POST body: { interaction_id: string }
 * Returns:   { success: boolean, message?: string, error?: string }
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body?.interaction_id) {
      return NextResponse.json(
        { success: false, error: "Missing interaction_id" },
        { status: 400 }
      );
    }

    if (!INTERNAL_API_KEY) {
      return NextResponse.json(
        { success: false, error: "INTERNAL_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const res = await fetch(`${BACKEND_URL}/api/responder/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ interaction_id: body.interaction_id }),
      signal: AbortSignal.timeout(10000), // 10s — WhatsApp send can be slow
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
