import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL  || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

// Pipe the raw multipart body straight through to the Express backend.
// Multer on the backend handles parsing — we must not consume the body here.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  const body = await req.arrayBuffer();

  const res = await fetch(`${BACKEND_URL}/api/products/import`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-internal-key': INTERNAL_KEY,
    },
    body,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
