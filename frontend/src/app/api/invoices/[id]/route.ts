import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const res  = await fetch(`${BACKEND_URL}/api/invoices/${params.id}`, {
    headers: { Authorization: authHeader },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const res  = await fetch(`${BACKEND_URL}/api/invoices/${params.id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const res  = await fetch(`${BACKEND_URL}/api/invoices/${params.id}`, {
    method:  'DELETE',
    headers: { Authorization: authHeader },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
