-- phase_h_3_brand_dna_write_policies
--
-- APPLIED LIVE via Supabase MCP on 2026-08-23 during the pre-launch demo
-- dry-run (DB_AUDIT_REPORT.md Section 41). This file is the post-hoc
-- tracked record of that change, reconstructed from
-- supabase_migrations.schema_migrations so the repo matches live schema.
--
-- Third and final part of the brand_dna fix from this dry-run (2026-08-23).
-- After phase_h_1 (missing tagline column, relaxed NOT NULLs) and
-- phase_h_2 (missing unique constraint for ON CONFLICT), the same upsert
-- still failed: "new row violates row-level security policy for table
-- brand_dna". Root cause: brand_dna has only ever had two SELECT policies
-- (anon_bootstrap_brand_dna, tenant_read_brand_dna, per the 2026-08-21
-- anon-read-scoping fix) -- no INSERT or UPDATE policy has ever existed for
-- this table. Combined with phase_h_1/h_2, this means brand_dna writes have
-- been completely non-functional for every real tenant since RLS was
-- locked down (Phase D, 2026-08-20) -- both onboarding wizards that write
-- to it (POST /api/brand-dna and /onboarding/brand-dna) have never
-- succeeded once in that window, for any tenant.
-- Fix: add INSERT and UPDATE policies scoped to tenant_id = auth_tenant_id(),
-- matching the "one policy per command" pattern already used by
-- system_logs (Phase F) and every other tenant-scoped table since Phase D.
create policy tenant_insert_brand_dna
  on public.brand_dna
  for insert
  to authenticated
  with check (tenant_id = auth_tenant_id());

create policy tenant_update_brand_dna
  on public.brand_dna
  for update
  to authenticated
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());
