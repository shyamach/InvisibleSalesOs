-- phase_1_17_user_tenants_user_id_fk
--
-- Applied live via the Supabase MCP `apply_migration` tool on 2026-08-18,
-- Phase B item B5 of the master development plan from the same day's audit.
--
-- user_tenants.user_id had no FK constraint to auth.users, so a row could
-- reference a nonexistent/deleted user with nothing enforcing referential
-- integrity. Adding ON DELETE CASCADE so a deleted auth user's tenant
-- memberships are cleaned up automatically rather than left orphaned.

ALTER TABLE public.user_tenants
  ADD CONSTRAINT user_tenants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
