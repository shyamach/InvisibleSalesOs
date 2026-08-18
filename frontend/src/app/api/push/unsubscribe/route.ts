/**
 * POST /api/push/unsubscribe
 * Removes a push subscription from Supabase.
 * Body: { endpoint }
 *
 * 2026-08-18 audit fix A5 — previously called the Supabase REST API directly
 * with the bare anon key and no auth, deleting by a raw endpoint string with
 * no ownership check at all (anyone could delete any tenant's subscription
 * by guessing/observing an endpoint URL). Now requires a real bearer session
 * and scopes the delete to that user's own tenant.
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
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: endpoint' },
        { status: 400 }
      );
    }

    const { error } = await verified.client
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('tenant_id', verified.tenantId);

    if (error) {
      console.error('[Push Unsubscribe]: Supabase error:', error.message);
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
