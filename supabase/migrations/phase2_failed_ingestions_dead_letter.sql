-- phase2_failed_ingestions_dead_letter
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- approval (apply via the Supabase MCP `apply_migration` tool, then update
-- DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 0 (architecture.md §6) — data-safety net. engine.js already attempts
-- a best-effort write to this table on triage/parse/draft failure (commit
-- 3da2823); until this migration is applied, that write silently no-ops
-- against a table that doesn't exist yet.
--
-- Reviewed by database-lead, security-lead, cto-ai. Key decisions:
--   - `stage` is free-text, not a CHECK-constrained enum: a constraint
--     violation on the dead-letter write itself would silently swallow a
--     second failure on top of the original one (recordFailedIngestion's
--     own try/catch would just log a warning), defeating the table's purpose.
--   - `raw_payload` is TEXT, not JSONB: engine.js always sends a plain string
--     today; JSONB adds parsing/quoting overhead for no current benefit.
--   - Size caps on raw_payload/parsed_profile are a hard requirement
--     (security-lead), not optional — bounds the PII/cost blast radius of a
--     single row.
--   - tenant_id FK to tenants(id) was verified safe: the dev-fallback tenant
--     00000000-0000-0000-0000-000000000001 was confirmed to exist via a
--     read-only SELECT before this file was drafted.

CREATE TABLE failed_ingestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_id_source  TEXT NOT NULL DEFAULT 'default_fallback'
                       CHECK (tenant_id_source IN ('brand_dna', 'default_fallback')),
  channel           TEXT NOT NULL,
  stage             TEXT NOT NULL,
  raw_payload       TEXT NOT NULL CHECK (length(raw_payload) <= 20000),
  parsed_profile    JSONB CHECK (parsed_profile IS NULL OR length(parsed_profile::text) <= 20000),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX idx_failed_ingestions_tenant_unresolved
  ON failed_ingestions (tenant_id, created_at DESC) WHERE resolved_at IS NULL;

CREATE INDEX idx_failed_ingestions_stage_recent
  ON failed_ingestions (stage, created_at DESC);

ALTER TABLE failed_ingestions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- TEMPORARY COMPROMISE — NOT THE TARGET SECURITY MODEL.
--
-- engine.js currently writes via the Supabase client in lib/supabase.js,
-- which is built with SUPABASE_ANON_KEY (not a service-role key). Denying
-- INSERT to the anon role here would make every Block 0 dead-letter write
-- fail silently in production (caught by recordFailedIngestion's own
-- try/catch, logged as a harmless warning) — meaning the whole feature
-- would appear to work, pass every test, and persist zero rows, forever.
--
-- Tracked follow-up: once Block 1 (tenant-scoping auth fix) lands, the
-- target end-state is server-side/service-role persistence for
-- failed_ingestions writes, with this anon INSERT policy REMOVED and
-- replaced by a service-role-scoped write path. This is a deliberate,
-- time-boxed interim step — log its removal as a Block 1 follow-up task,
-- not something to leave in place indefinitely.
-- ─────────────────────────────────────────────────────────────────────────
CREATE POLICY "failed_ingestions_insert_temp_anon" ON failed_ingestions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policy for anon or authenticated roles, by design.
-- tenant_id on rows inserted before Block 1 is unverified (resolved via
-- brand_dna.tenant_id or a dev-fallback UUID, never a verified JWT session) —
-- this table is deliberately service-role-only to read/triage until Block 1
-- makes tenant-scoped SELECT policies meaningful. Do not add a permissive
-- SELECT/UPDATE/DELETE policy without re-reviewing this decision.
