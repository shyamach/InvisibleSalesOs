import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

// window.open() triggers this route as a plain browser navigation, which
// cannot carry a custom Authorization header — unlike every other invoice
// proxy, this one reads the logged-in user's session from cookies
// server-side (same mechanism as middleware.ts) instead of forwarding an
// incoming header.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* read-only here — no response to attach refreshed cookies to */ },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const res = await fetch(`${BACKEND_URL}/api/invoices/${params.id}/pdf`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
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
