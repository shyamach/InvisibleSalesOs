/**
 * /api/tenants — Server-side proxy for POST /api/tenants/register.
 *
 * Keeps INTERNAL_API_KEY server-side only (never NEXT_PUBLIC_).
 * Called by the /signup page on form submission.
 *
 * POST body: { name, owner_name, owner_email, whatsapp_number, country?, business_type? }
 * Returns:   { success, tenant_id, slug, setup_token } (201)
 *          | { success: false, error } (400 / 409 / 500)
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Basic guard — let the backend do the full validation
    if (!body?.name || !body?.owner_email || !body?.whatsapp_number) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: name, owner_email, whatsapp_number" },
        { status: 400 }
      );
    }

    if (!INTERNAL_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Server configuration error." },
        { status: 500 }
      );
    }

    const res = await fetch(`${BACKEND_URL}/api/tenants/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
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
