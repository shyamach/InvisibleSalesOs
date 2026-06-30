import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL   || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export async function POST(req: NextRequest) {
  // Forward the multipart form data directly to the backend
  const formData = await req.formData();
  const file = formData.get('invoice') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Rebuild form for the backend
  const backendForm = new FormData();
  backendForm.append('invoice', file, file.name);

  const res = await fetch(`${BACKEND_URL}/api/invoices/upload`, {
    method:  'POST',
    headers: { 'x-internal-key': INTERNAL_KEY },
    body:    backendForm,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
