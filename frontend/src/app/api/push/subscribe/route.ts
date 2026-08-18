/**
 * POST /api/push/subscribe
 * Receives a push subscription from the browser and saves it to Supabase.
 * Body: { endpoint, p256dh, auth }
 * UPSERTs on endpoint so re-subscribing (e.g. after key refresh) is safe.
 *
 * 2026-08-18 audit fix A5 — previously called the Supabase REST API directly
 * with the bare anon key and no auth, trusting a client-supplied tenant_id.
 * Now requires a real bearer session and derives tenant_id server-side from
 * that user's own tenant membership; the write runs as the caller's own
 * authenticated role so RLS applies normally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getVerifiedTenant(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: membership } = await supabase
    .from('user_tenants')
    .select('tenant_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.tenant_id) return null;
  return { tenantId: membership.tenant_id as string, client: supabase };
}

export async function POST(req: NextRequest) {
  try {
    const verified = await getVerifiedTenant(req.headers.get('authorization'));
    if (!verified) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { endpoint, p256dh, auth } = body;

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: endpoint, p256dh, auth' },
        { status: 400 }
      );
    }

    const { error } = await verified.client
      .from('push_subscriptions')
      .upsert(
        {
          tenant_id: verified.tenantId,
          endpoint,
          p256dh,
          auth,
          user_agent: req.headers.get('user-agent') || '',
        },
        { onConflict: 'endpoint' }
      );

    if (error) {
      console.error('[Push Subscribe]: Supabase error:', error.message);
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
