/**
 * POST /api/push/subscribe
 * Receives a push subscription from the browser and saves it to Supabase.
 * Body: { endpoint, p256dh, auth, tenant_id }
 * UPSERTs on endpoint so re-subscribing (e.g. after key refresh) is safe.
 */

import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, p256dh, auth, tenant_id } = body;

    if (!endpoint || !p256dh || !auth || !tenant_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: endpoint, p256dh, auth, tenant_id' },
        { status: 400 }
      );
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          // UPSERT on endpoint — safe to call multiple times
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          tenant_id,
          endpoint,
          p256dh,
          auth,
          user_agent: req.headers.get('user-agent') || '',
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[Push Subscribe]: Supabase error:', text);
      return NextResponse.json(
        { success: false, error: 'Failed to save subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Push Subscribe]: Unexpected error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
