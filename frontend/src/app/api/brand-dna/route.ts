/**
 * /api/brand-dna — Quick brand DNA upsert from the setup wizard.
 *
 * POST body: { tone_notes, product_catalog, tagline? }
 * Returns:   { success: true } (200) | { success: false, error } (400/401/500)
 *
 * 2026-08-18 audit fix A4 — this route previously used the Supabase
 * service-role key (full RLS bypass) with no auth check at all, taking
 * tenant_id straight from the unauthenticated request body: any caller could
 * overwrite any tenant's brand_dna row. It now requires a real bearer
 * session, derives tenant_id server-side from that user's own tenant
 * membership, and performs the write with the caller's own token so RLS
 * applies normally — no service-role key involved.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function getVerifiedTenant(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: membership } = await supabase
    .from("user_tenants")
    .select("tenant_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.tenant_id) return null;
  return { tenantId: membership.tenant_id as string, client: supabase };
}

export async function POST(request: Request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { success: false, error: "Supabase not configured on server" },
        { status: 500 }
      );
    }

    const verified = await getVerifiedTenant(request.headers.get("authorization"));
    if (!verified) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { tone_notes, product_catalog, tagline } = body;

    const { error } = await verified.client
      .from("brand_dna")
      .upsert(
        {
          tenant_id: verified.tenantId,
          tone_notes: tone_notes ?? null,
          product_catalog: product_catalog ?? [],
          tagline: tagline ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" }
      );

    if (error) {
      console.error("[brand-dna route]: Upsert error:", error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
