import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
    method: 'DELETE',
    headers: { 'x-internal-key': INTERNAL_KEY },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
