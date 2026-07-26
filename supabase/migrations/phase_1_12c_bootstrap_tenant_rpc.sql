-- phase_1_12c_bootstrap_tenant_rpc
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 1.12c — narrow follow-on to Block 1.12b (commit 1efb190, hardened
-- auth_tenant_id() + backfilled the one real user -> the one real tenant).
-- The Block 1.12c planning audit (read-only, no files touched) confirmed:
--   - public.tenants has RLS enabled with SELECT and UPDATE policies only —
--     no INSERT policy exists for any role (confirmed via pg_policies: no
--     `cmd = 'INSERT'` row for this table).
--   - Table-level INSERT grants DO exist for anon/authenticated on tenants,
--     but RLS default-denies any command with zero matching permissive
--     policies regardless of the table grant — the grant is necessary but
--     not sufficient, and is not the blocker.
--   - registerWithAuth (controllers/auth.js) currently does two direct
--     inserts — `tenants` then `user_tenants` — on the shared anon-key
--     client. Both are broken at the DB layer today, independent of which
--     Supabase client makes the call: the `tenants` insert has no policy to
--     satisfy at all, and even a JWT-scoped `user_tenants` insert (which
--     user_tenants_self: auth.uid() = user_id WOULD allow for an
--     authenticated caller inserting their own row) cannot succeed first,
--     because it needs a tenant_id that doesn't exist yet.
--   - This is a genuine bootstrap chicken-and-egg problem: a brand-new user
--     has no tenant, no user_tenants row, and therefore no RLS predicate
--     that could ever be satisfied by either insert in isolation.
--
-- OPTIONS CONSIDERED (see Block 1.12c planning audit for full detail):
--   A. Add a bare `tenants` INSERT policy — REJECTED. tenants has no
--      owner_user_id (or equivalent) column, so the only honest policy
--      would be `WITH CHECK (true)` for authenticated — any logged-in user
--      could create unlimited tenants with no linkage guarantee, and the
--      follow-on user_tenants insert would still be a separate, unguarded
--      step (a crash between the two leaves an orphaned tenant with no
--      owner mapping, which is exactly what auth_tenant_id() reads).
--   B. Add owner_user_id column + RLS policy — REJECTED for this block.
--      Better than A, but still two unguarded steps with no atomicity, and
--      is a schema change; this audit's scope is explicitly "no schema
--      changes". A candidate for later enrichment on top of this RPC, not a
--      substitute for it.
--   C. Use a service-role key in the app — REJECTED. No service-role key
--      exists anywhere in this codebase (lib/supabase.js is anon-key only,
--      by design, since Block 1.4). Introducing one to run a raw insert from
--      Express would bypass RLS entirely for that code path with no scoping
--      logic at all — a far larger privilege surface than a single narrowly-
--      scoped RPC that only this migration defines.
--   E. An auth.users trigger auto-creating tenant + mapping on signup —
--      DEFERRED, wrong shape for this app. The tenant needs business_name/
--      country/business_type/etc. from the signup FORM, which a trigger
--      firing on auth.users insert has no access to (Supabase Auth's
--      signUp() only carries user_metadata, and the trigger fires
--      independently of the app's own registration API call). Would also
--      fire for any future magic-link/OAuth signup with zero business
--      context. May be revisited once/if signup no longer needs bespoke
--      form data at creation time.
--   D. SECURITY DEFINER bootstrap RPC — CHOSEN. Atomic (one transaction, one
--      round trip covering both inserts), can hard-code user_id = auth.uid()
--      and role = 'owner' server-side so neither is ever client-controlled,
--      can positively check auth.uid() IS NOT NULL before doing anything,
--      and can self-serialize concurrent calls for the same user via an
--      advisory lock rather than relying on a schema-level uniqueness
--      constraint that doesn't exist for this shape (user_tenants' unique
--      constraint is (user_id, tenant_id) — it does not stop two racing
--      calls for the same new user from creating two different tenants,
--      each with its own distinct tenant_id). This is also the established
--      pattern already used in this database for atomic multi-step writes
--      (see phase2_atomic_stock_movement_rpc.sql's adjust_product_stock())
--      and for controlled cross-schema reads (get_tenant_members,
--      get_user_id_by_email) — DB_AUDIT_REPORT.md Section 7 already named
--      this exact shape as the likely fix for this exact gap.
--
-- WHAT THIS MIGRATION DOES:
--   Defines public.bootstrap_tenant(p_name text, p_settings jsonb) — a
--   SECURITY DEFINER RPC that, for the calling authenticated user:
--     1. Rejects unauthenticated callers (auth.uid() IS NULL) with SQLSTATE
--        28000 (invalid_authorization_specification).
--     2. Acquires an advisory transaction lock keyed by the caller's user
--        id, serializing any concurrent bootstrap_tenant() calls from the
--        SAME user (double-click submit, client retry after a timeout where
--        the first call actually succeeded). The lock is transaction-scoped
--        (pg_advisory_xact_lock) and releases automatically on commit or
--        rollback — no explicit unlock, no risk of a held lock outliving
--        the call.
--     3. Re-checks user_tenants for an existing mapping AFTER acquiring the
--        lock (not before) — this is what makes the whole RPC idempotent
--        and race-safe: if a concurrent call already created the mapping
--        while this call was waiting on the lock, this call sees it (READ
--        COMMITTED re-reads per statement) and returns the EXISTING tenant
--        + role with already_registered = true instead of creating a
--        second tenant for the same user.
--     4. Otherwise validates p_name — rejects NULL or blank/whitespace-only
--        names (btrim(p_name) empty) with SQLSTATE 22023
--        (invalid_parameter_value) — checked here, after the idempotent
--        re-check rather than immediately after the auth check, so a caller
--        who already has a mapping still gets a clean idempotent response
--        even if p_name happens to be blank on a retry; the name is only
--        actually needed once a row is about to be created.
--     5. Inserts one `tenants` row (name = btrim(p_name) — the trimmed
--        value, not the raw parameter — owner_email derived server-side
--        from auth.users via auth.uid() — never client-supplied, settings =
--        COALESCE(p_settings, '{}'::jsonb), subscription_tier/
--        trial_started_at left to their existing column defaults, no slug
--        column referenced) and one `user_tenants` row (user_id =
--        auth.uid(), tenant_id = the just-created tenant, role hard-coded
--        to 'owner' — never client-supplied), then returns the new tenant +
--        role with already_registered = false.
--   Runs as SECURITY DEFINER (owned by the migration-applying role,
--   `postgres`, matching auth_tenant_id()/get_tenant_members/
--   get_user_id_by_email) so the two inserts are not subject to `tenants`'
--   (missing) INSERT policy or to re-deriving `user_tenants_self` by hand —
--   the function body itself is the only privilege boundary, which is why
--   every input that could affect WHO gets inserted (user_id, owner_email,
--   role) is derived server-side rather than accepted as a parameter.
--
-- GRANTS:
--   EXECUTE is granted to `authenticated` only (required — this RPC is
--   meaningless to call without a real auth.uid()) plus `postgres` (admin/
--   ops parity with the existing SECURITY DEFINER functions in this
--   database, all of which grant postgres EXECUTE regardless of app usage).
--   `anon` is deliberately NOT granted EXECUTE: unlike auth_tenant_id(),
--   nothing depends on an unauthenticated caller being able to invoke this
--   function (no RLS policy evaluates bootstrap_tenant() the way policies
--   evaluate auth_tenant_id()), so there is no forcing reason to expose a
--   row-writing SECURITY DEFINER function to anon, even though its own
--   internal auth.uid() IS NULL check would reject the call anyway —
--   revoking EXECUTE is a strictly tighter, equally-correct posture.
--   `service_role` is NOT granted here either: no service-role key exists
--   anywhere in this app (see Option C above), so there is no caller that
--   would ever use it, and the existing repo convention for a write RPC
--   (adjust_product_stock) grants only the one role the app actually
--   connects as — this migration follows the same principle for the role
--   the app actually uses for authenticated requests (`authenticated`, via
--   req.supabase / createRequestClient), not a broader set "just in case".
--
-- OUT OF SCOPE — deliberately NOT done here, tracked separately:
--   - No RLS policy is added, changed, or removed on `tenants` or
--     `user_tenants` — this migration adds one function and its grants,
--     nothing else. `tenants` still has no INSERT policy after this
--     migration; the RPC's SECURITY DEFINER property is what makes the
--     insert possible, not a new policy.
--   - `tenants`' unscoped `authenticated_read_tenants` SELECT policy
--     (`USING (true)`, roles anon+authenticated) is untouched — a separate,
--     already-tracked gap (DB_AUDIT_REPORT.md Section 7).
--   - No dev-fallback branch is removed from any policy, on `tenants` or any
--     other table.
--   - `auth_tenant_id()` is not modified.
--   - No `tenants` or `user_tenants` schema change — no new column
--     (including no `owner_user_id`), no new constraint, no new index.
--   - No `auth.users` trigger (Option E, deferred — see above).
--   - No service-role key introduced (Option C, rejected — see above).
--   - Lane C frontend pages, Decision Brain, Inventory Engine — untouched.
--
-- Rollback: this migration only adds a new function and its grants, so
-- rollback is a straightforward drop — nothing to restore, since nothing
-- pre-existing was replaced.
--
-- ROLLBACK (commented out — for reference only, do not run alongside the
-- statements below in the same migration):
--
-- DROP FUNCTION IF EXISTS public.bootstrap_tenant(text, jsonb);

-- 1. Define the bootstrap RPC.
CREATE OR REPLACE FUNCTION public.bootstrap_tenant(
  p_name text,
  p_settings jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid             uuid;
  v_owner_email     text;
  v_existing_tenant uuid;
  v_existing_role   text;
  v_tenant          public.tenants%ROWTYPE;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bootstrap_tenant requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  -- Serialize concurrent bootstrap calls for this same user (double-click
  -- submit, client retry after a timeout). Transaction-scoped: releases
  -- automatically on commit or rollback, no explicit unlock needed.
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  -- Re-check for an existing mapping now that we hold the lock — a
  -- concurrent call that ran first may have already created it while this
  -- call was waiting. This is what makes the RPC itself idempotent and
  -- race-safe, not just the JS-layer existingTenantId check in
  -- controllers/auth.js (which reads tenantId in a separate, earlier query
  -- that both racing requests could see as null).
  SELECT ut.tenant_id, ut.role
  INTO v_existing_tenant, v_existing_role
  FROM public.user_tenants ut
  WHERE ut.user_id = v_uid
  ORDER BY ut.created_at ASC, ut.id ASC
  LIMIT 1;

  IF v_existing_tenant IS NOT NULL THEN
    SELECT * INTO v_tenant FROM public.tenants WHERE id = v_existing_tenant;

    RETURN jsonb_build_object(
      'tenant', to_jsonb(v_tenant),
      'role', v_existing_role,
      'already_registered', true
    );
  END IF;

  -- Validate the tenant name before any write. Checked here — after the
  -- idempotent re-check, before the insert — rather than immediately after
  -- the auth check, so a caller who already has a mapping still gets a
  -- clean idempotent response above even if p_name happens to be blank on a
  -- retry; the name is only actually needed once we're about to create a
  -- row. btrim() rejects whitespace-only names, not just NULL/''.
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'bootstrap_tenant requires a non-empty tenant name'
      USING ERRCODE = '22023';
  END IF;

  -- Derive the owner's email server-side from auth.users — never trust a
  -- client-supplied owner_email.
  SELECT email INTO v_owner_email
  FROM auth.users
  WHERE id = v_uid;

  -- subscription_tier and trial_started_at are left to their existing
  -- column defaults ('trial' / now()). No slug column exists on tenants —
  -- do not insert one. Insert the trimmed name, not the raw p_name.
  INSERT INTO public.tenants (name, owner_email, settings)
  VALUES (btrim(p_name), v_owner_email, COALESCE(p_settings, '{}'::jsonb))
  RETURNING * INTO v_tenant;

  -- user_id and role are never client-controlled: user_id is always the
  -- caller's own auth.uid(), role is always 'owner' for a bootstrap call.
  INSERT INTO public.user_tenants (user_id, tenant_id, role)
  VALUES (v_uid, v_tenant.id, 'owner');

  RETURN jsonb_build_object(
    'tenant', to_jsonb(v_tenant),
    'role', 'owner',
    'already_registered', false
  );
END;
$$;

-- 2. Grants — authenticated + postgres only. See "GRANTS" note above for
--    why anon and service_role are deliberately excluded.
REVOKE EXECUTE ON FUNCTION public.bootstrap_tenant(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant(text, jsonb) TO postgres;
