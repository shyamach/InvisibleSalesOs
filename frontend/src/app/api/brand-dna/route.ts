/**
 * /api/brand-dna — Quick brand DNA upsert from the setup wizard.
 *
 * This is a lightweight server-side route that upserts a brand_dna row
 * directly via the Supabase service-role key (kept server-side only).
 *
 * The full Brand DNA Wizard at /onboarding/brand-dna uses the anon key
 * via the Supabase client directly. This route handles the quick-save
 * in the setup wizard's Step 3.
 *
 * POST body: { tenant_id, tone_notes, product_catalog, tagline? }
 * Returns:   { success: true } (200) | { success: false, error } (400/500)
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use the service-role key so this route can bypass RLS
// This key is NEVER exposed to the browser (no NEXT_PUBLIC_ prefix)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tenant_id, tone_notes, product_catalog, tagline } = body;

    if (!tenant_id) {
      return NextResponse.json(
        { success: false, error: "Missing tenant_id" },
        { status: 400 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: "Supabase not configured on server" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase
      .from("brand_dna")
      .upsert(
        {
          tenant_id,
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
