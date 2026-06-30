/**
 * POST /api/push/unsubscribe
 * Removes a push subscription from Supabase.
 * Body: { endpoint }
 */

import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: endpoint' },
        { status: 400 }
      );
    }

    // URL-encode the endpoint for the query string filter
    const encodedEndpoint = encodeURIComponent(endpoint);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodedEndpoint}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[Push Unsubscribe]: Supabase error:', text);
      return NextResponse.json(
        { success: false, error: 'Failed to delete subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Push Unsubscribe]: Unexpected error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
