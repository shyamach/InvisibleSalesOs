-- phase_f_1_system_logs_table
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Phase F, step 1 — a persistent, categorized system-events log, backing a
-- new operator logs dashboard. Phase E (Sections 30-34) gave every
-- background worker an in-memory get*Status() getter, but those only ever
-- hold the MOST RECENT state — no history, reset on every restart, and only
-- reachable via curl + INTERNAL_API_KEY. This table is the append-only
-- event history those getters were never meant to be; the dashboard's
-- summary view still reads the live getters for "current state" and reads
-- this table for "what's happened" / "how often" / "categorized errors".
--
-- Shape follows the existing failed_ingestions table's precedent (categorized
-- dead-letter log, tenant-scoped, JSONB detail column) rather than inventing
-- a new pattern.
--
-- Rollback: DROP TABLE public.system_logs;

CREATE TABLE public.system_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning', 'info')),
  message     TEXT NOT NULL,
  detail      JSONB,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.system_logs IS
  'Append-only categorized system event log (errors/warnings/info from background workers, crash containment, circuit breakers). Not a request-audit-log — see DB_AUDIT_REPORT.md Phase F for the category vocabulary.';

-- Every real query shape this table needs to serve: "recent events for this
-- tenant" (dashboard summary + logs page default view), "events in category
-- X" (category filter), "events at severity Y" (severity filter, e.g.
-- 'error' only). One composite index covers all three via leading-column
-- reuse (tenant_id always present; category/severity filters compose with a
-- created_at DESC scan even without their own dedicated index at this
-- table's expected volume).
CREATE INDEX idx_system_logs_tenant_created ON public.system_logs (tenant_id, created_at DESC);
CREATE INDEX idx_system_logs_tenant_category ON public.system_logs (tenant_id, category, created_at DESC);
CREATE INDEX idx_system_logs_tenant_severity ON public.system_logs (tenant_id, severity, created_at DESC);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- Real per-tenant isolation from day one — no dev-fallback OR-branch (Phase D
-- closed that pattern out entirely, Section 28). Both real authenticated
-- users (auth.uid() → auth_tenant_id()) and background workers' system-JWT
-- clients (the app_tenant_id claim fallback, Section 25) resolve
-- auth_tenant_id() correctly, so one policy per command covers both caller
-- shapes without any special-casing.
CREATE POLICY system_logs_tenant_select ON public.system_logs
  FOR SELECT
  USING (tenant_id = auth_tenant_id());

CREATE POLICY system_logs_tenant_insert ON public.system_logs
  FOR INSERT
  WITH CHECK (tenant_id = auth_tenant_id());

-- No UPDATE/DELETE policy — append-only by design, default-deny for both,
-- matching failed_ingestions' shape (that table only gained a resolved_at
-- column for app-level bookkeeping, never a DELETE path). If a retention/
-- purge job is ever needed, it belongs in a separate, explicit migration.

GRANT SELECT, INSERT ON public.system_logs TO authenticated;
