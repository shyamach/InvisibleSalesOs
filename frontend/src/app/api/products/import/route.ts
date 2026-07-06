import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

// Pipe the raw multipart body straight through to the Express backend.
// Multer on the backend handles parsing — we must not consume the body here.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') || '';
  const body = await req.arrayBuffer();

  const res = await fetch(`${BACKEND_URL}/api/products/import`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      Authorization: authHeader,
    },
    body,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
