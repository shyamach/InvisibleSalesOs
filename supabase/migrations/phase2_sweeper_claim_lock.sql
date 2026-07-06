-- phase2_sweeper_claim_lock
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- approval (apply via the Supabase MCP `apply_migration` tool, then update
-- DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 0 (architecture.md §6) — data-safety net, item 3 of 3 (sweeper
-- claim-lock). lib/autoReplySweeper.js#sweepScheduledReplies currently
-- SELECTs due leads (auto_reply_status='scheduled', scheduled_dispatch_at
-- elapsed), then for each one: dispatches the message, THEN marks
-- auto_reply_status='sent' guarded by `.eq('auto_reply_status','scheduled')`.
-- The guard protects the STATUS TRANSITION from a stale write, but does
-- nothing to prevent two overlapping sweeper runs (two setInterval ticks
-- during a slow run, two processes during a rolling deploy, a supervisor
-- restart racing an in-flight tick) from both SELECTing the same due lead
-- and both calling `dispatch()` — a real customer-facing WhatsApp/email
-- send — before either has updated the row. This is a double-send bug, not
-- a data-integrity bug: the ledger/status ends up correct either way (last
-- writer sets 'sent'), but the customer can receive the same message twice.
--
-- Fix: add a single nullable `claimed_at` column and turn dispatch into a
-- "claim, then act" flow — an atomic conditional UPDATE (single Postgres
-- statement, same guarded-update pattern this file already uses for its
-- "mark sent" step) flips claimed_at from NULL/stale to now() before any
-- dispatch is attempted. Only one concurrent caller can win that UPDATE for
-- a given row; the loser's WHERE clause re-evaluates against the
-- already-claimed row and matches zero rows, so it skips the lead instead
-- of dispatching.
--
-- Why a plain conditional UPDATE instead of a Postgres RPC using
-- `SELECT ... FOR UPDATE SKIP LOCKED`: this app has no raw-SQL/transaction
-- access from the backend (Supabase JS client over PostgREST, same as
-- everywhere else in this codebase) — FOR UPDATE SKIP LOCKED would need to
-- be wrapped in a new Postgres function to be callable at all. The existing
-- code already achieves the same per-row exclusivity with a single
-- conditional UPDATE (Postgres guarantees only one concurrent UPDATE can
-- satisfy a given WHERE clause against one row; the loser's WHERE
-- re-evaluates post-commit and no longer matches). Adding a column is a
-- smaller, easier-to-review change than adding a new RPC for this
-- particular access pattern (single-row claim, not a batch dequeue).
--
-- Crash/expiry recovery: a claim is only valid for CLAIM_STALE_MS (5
-- minutes, see lib/autoReplySweeper.js) from when it was taken. If a
-- sweeper process claims a lead and then crashes before finishing, the
-- claim naturally expires and a later run can reclaim it — no manual
-- intervention or separate cleanup job needed. On an ordinary dispatch
-- failure (not a crash), the app explicitly releases the claim
-- (`claimed_at = NULL`) immediately so the very next tick can retry without
-- waiting out the staleness window.
--
-- No RLS/policy changes needed — `claimed_at` is written via the same
-- `smart_leads_tenant_update` policy path the existing "mark sent" write
-- already uses.

ALTER TABLE smart_leads
  ADD COLUMN claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN smart_leads.claimed_at IS
  'Sweeper claim-lock timestamp (Block 0.3). Set atomically by an UPDATE ... WHERE auto_reply_status = ''scheduled'' AND (claimed_at IS NULL OR claimed_at < now() - stale_window) before dispatching, to prevent two overlapping sweeper runs from double-sending the same message. Cleared back to NULL on a failed dispatch to allow immediate retry; naturally expires after the staleness window if a sweeper crashes mid-claim.';
