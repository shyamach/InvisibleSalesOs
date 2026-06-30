/**
 * /api/digest/[...path] — Catch-all proxy to backend digest routes.
 *
 * Forwards requests to Express /api/digest/* with the internal API key.
 * Keeps INTERNAL_API_KEY server-side only — never exposed to the browser.
 *
 * Routes proxied:
 *   GET  /api/digest/preview       → GET  {BACKEND}/api/digest/preview
 *   POST /api/digest/send-preview  → POST {BACKEND}/api/digest/send-preview
 */
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

async function proxyRequest(request: Request, path: string[]) {
  const backendPath = `/api/digest/${path.join("/")}`;
  const url = new URL(request.url);
  const query = url.search; // forward query params (e.g. ?tenant_id=...)
  const targetUrl = `${BACKEND_URL}${backendPath}${query}`;

  if (!INTERNAL_API_KEY) {
    return NextResponse.json(
      { success: false, error: "INTERNAL_API_KEY not configured on server" },
      { status: 500 }
    );
  }

  try {
    const isPost = request.method === "POST";
    const body = isPost ? await request.text() : undefined;

    const res = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(30_000), // 30s — AI generation can be slow
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

export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path);
}

export async function POST(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params.path);
}
