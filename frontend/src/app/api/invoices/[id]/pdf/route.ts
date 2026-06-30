import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL  = process.env.BACKEND_URL   || 'http://127.0.0.1:3001';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const res = await fetch(`${BACKEND_URL}/api/invoices/${params.id}/pdf`, {
    headers: { 'x-internal-key': INTERNAL_KEY },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'PDF generation failed' }));
    return NextResponse.json(err, { status: res.status });
  }

  const pdfBuffer = await res.arrayBuffer();
  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice.pdf"`,
    },
  });
}
