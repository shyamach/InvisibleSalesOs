import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL   || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export async function POST(req: NextRequest, { params }: { params: { quoteId: string } }) {
  const body = await req.json().catch(() => ({}));
  const res  = await fetch(`${BACKEND_URL}/api/invoices/from-quote/${params.quoteId}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
