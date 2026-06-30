/**
 * /api/tenants/[id]/status — Server-side proxy for GET /api/tenants/:id/status.
 *
 * Keeps INTERNAL_API_KEY server-side only (never NEXT_PUBLIC_).
 * Called by the /onboarding/setup wizard to track completion.
 *
 * Returns: {
 *   success: true,
 *   tenant: { id, name, subscription_tier },
 *   steps: { registered, brand_dna_complete, whatsapp_connected },
 *   completion_pct: number
 * }
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing tenant id" },
      { status: 400 }
    );
  }

  if (!INTERNAL_API_KEY) {
    return NextResponse.json(
      { success: false, error: "Server configuration error." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/tenants/${id}/status`, {
      method: "GET",
      headers: {
        "x-internal-key": INTERNAL_API_KEY,
      },
      signal: AbortSignal.timeout(6000),
    });

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Backend unavailable: ${message}` },
      { status: 503 }
    );
  }
}
