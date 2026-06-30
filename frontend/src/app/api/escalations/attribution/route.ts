import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET(_req: NextRequest) {
  const res = await fetch(`${BACKEND_URL}/api/escalations/attribution`, {
    headers: { 'x-internal-key': INTERNAL_KEY },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
