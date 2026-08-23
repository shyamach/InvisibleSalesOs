-- phase_h_1_brand_dna_schema_fix
--
-- APPLIED LIVE via Supabase MCP on 2026-08-23 during the pre-launch demo
-- dry-run (DB_AUDIT_REPORT.md Section 41). This file is the post-hoc
-- tracked record of that change, reconstructed from
-- supabase_migrations.schema_migrations so the repo matches live schema.
--
-- Fixes a demo-blocking bug found during pre-launch dry-run (2026-08-23):
-- both live write paths to brand_dna (POST /api/brand-dna, used by the
-- 4-step onboarding wizard's step 3, and the sidebar-linked
-- /onboarding/brand-dna wizard) have been failing on every real call since
-- they were written, because the actual table schema never matched what
-- either route sends:
--   1. Neither route sets brand_name or brand_voice_guidelines, both
--      NOT NULL with no default -> every upsert would violate the
--      constraint once past PostgREST's own request-shape validation.
--   2. POST /api/brand-dna also sends a `tagline` field the table has
--      never had at all -> PostgREST rejects the request outright
--      ("Could not find the 'tagline' column of 'brand_dna' in the schema
--      cache"), which is the concrete 500 hit live during this dry-run.
-- Fix: add the missing nullable `tagline` column, and drop NOT NULL on the
-- two columns neither live caller ever populates. Purely additive/relaxing
-- (add nullable column, drop NOT NULL) -- no data loss, no narrowing.
alter table public.brand_dna
  add column if not exists tagline text,
  alter column brand_name drop not null,
  alter column brand_voice_guidelines drop not null;
