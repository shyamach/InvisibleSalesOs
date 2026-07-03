-- phase2_atomic_stock_movement_rpc
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- approval (apply via the Supabase MCP `apply_migration` tool, then update
-- DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 0 (architecture.md §6) — data-safety net, item 2 of 2 (atomic
-- stock-movement update). Investigation (see planning report, 2026-07-03)
-- found that controllers/products.js#adjustStock does read -> JS compute ->
-- product UPDATE -> stock_movements INSERT as three separate round trips
-- with no transaction or row lock: two concurrent adjustments on the same
-- product can lose an update (last write wins) while both still write a
-- stock_movements row, silently diverging the ledger from the live balance.
-- Separately, controllers/productImport.js inserted an opening-stock
-- stock_movements row on the assumption that a BEFORE INSERT trigger would
-- update products.stock_quantity — no such trigger exists (verified against
-- the live schema), so imported opening stock has been silently staying at
-- zero. This migration fixes both call sites by giving them one atomic,
-- authoritative write path.
--
-- Key decisions:
--   - Function name is `adjust_product_stock`, deliberately NOT reusing the
--     existing `apply_stock_movement()` name already present in this
--     database. That existing function is dead/orphaned: it references
--     `public.inventory`, which was dropped in `phase1_retire_legacy_inventory`
--     (20260628155031), and it is not attached to any trigger today. It is
--     left untouched by this migration — do not drop or replace it here;
--     track its removal as separate follow-up debt so this migration stays
--     minimal and easy to review/rollback. The same applies to the unattached
--     `prevent_stock_movement_mutation()` function.
--   - SECURITY INVOKER (the default — no SECURITY DEFINER clause), not
--     SECURITY DEFINER. Checked the live grants/RLS before choosing this:
--     the `anon` role (the only role this backend uses today — see
--     lib/supabase.js, SUPABASE_ANON_KEY, no per-user JWT sessions yet)
--     already has table-level SELECT/INSERT/UPDATE grants on both `products`
--     and `stock_movements`, and RLS already has tenant-scoped SELECT/
--     INSERT/UPDATE policies on `products` and tenant-scoped SELECT/INSERT
--     policies on `stock_movements` (no UPDATE/DELETE policy on
--     stock_movements — append-only by omission). A SECURITY INVOKER
--     function runs as the calling role and is subject to those same RLS
--     policies, identically to the raw table calls it replaces — so it adds
--     no new privilege surface. SECURITY DEFINER would bypass RLS entirely
--     and require re-deriving the tenant check by hand inside the function
--     body with no RLS backstop if that check is ever wrong; there is no
--     need to take on that risk here since RLS already does the job.
--     Flagging this choice explicitly for security-lead/database-lead
--     sign-off before apply, since it is a deviation from the earlier plan
--     draft (which had assumed SECURITY DEFINER would be required).
--   - `SET search_path = public` is set regardless of SECURITY INVOKER vs
--     DEFINER — defends against search_path hijacking and avoids the
--     "Function Search Path Mutable" advisory warning.
--   - `SELECT ... FOR UPDATE` inside the function locks the target product
--     row so a second concurrent call on the same product_id blocks until
--     the first transaction (the single function call) commits — this is
--     what makes the read-check-write atomic without any application-level
--     locking.
--   - Negative stock is blocked unless p_allow_negative is explicitly true,
--     mirroring the existing lib/catalogue.js#computeStockChange contract.
--     That JS function is NOT deleted by this migration (still unit-tested,
--     still useful for HTTP-layer input shape) but is no longer the
--     authoritative source of the applied balance_after — this function is.
--   - Return value is a single jsonb object shaped
--     `{ "product": <full products row>, "movement": <full stock_movements
--     row> }` so callers (controllers/products.js, controllers/
--     productImport.js) get everything needed to respond without any
--     further read.
--   - Error signaling uses distinct SQLSTATEs so the JS caller can branch
--     without string-matching: 'P0002' (Postgres's standard "no_data_found"
--     condition code) for "product not found for this tenant", and a custom
--     'ISTOK' code for "insufficient stock and allow_negative was false".
--     Both also carry a human-readable message for logging/display.
--
-- Explicitly out of scope (per accepted plan): quote/invoice stock
-- consumption (no such path exists in the app yet), the auto-reply sweeper
-- claim-lock, and the auth.uid() -> tenant_id RLS mapping gap.
--
-- Pending review by database-lead and security-lead before this is applied.

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_tenant_id      UUID,
  p_product_id     UUID,
  p_delta          INTEGER,
  p_reason         TEXT DEFAULT 'manual_adjustment',
  p_note           TEXT DEFAULT NULL,
  p_allow_negative BOOLEAN DEFAULT false,
  p_created_by     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product        products%ROWTYPE;
  v_movement       stock_movements%ROWTYPE;
  v_balance_after  INTEGER;
  v_status         TEXT;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta must be a non-zero integer';
  END IF;

  -- Row lock: a concurrent call on the same product_id blocks here until
  -- this function call's implicit transaction commits or rolls back.
  SELECT * INTO v_product
  FROM products
  WHERE id = p_product_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product % not found for tenant %', p_product_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  v_balance_after := v_product.stock_quantity + p_delta;

  IF v_balance_after < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'insufficient stock: % on hand, cannot apply %', v_product.stock_quantity, p_delta
      USING ERRCODE = 'ISTOK';
  END IF;

  v_status := CASE
    WHEN v_product.status = 'archived' THEN 'archived'
    WHEN v_balance_after <= 0 THEN 'out_of_stock'
    ELSE 'active'
  END;

  UPDATE products
  SET stock_quantity = v_balance_after,
      status = v_status
  WHERE id = p_product_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  RETURNING * INTO v_product;

  INSERT INTO stock_movements (tenant_id, product_id, delta, balance_after, reason, note, created_by)
  VALUES (p_tenant_id, p_product_id, p_delta, v_balance_after, p_reason, p_note, p_created_by)
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object('product', to_jsonb(v_product), 'movement', to_jsonb(v_movement));
END;
$$;

-- PostgREST requires an explicit EXECUTE grant to expose a function over
-- supabase.rpc(). Granted only to `anon` — the only role this backend
-- actually uses today (lib/supabase.js, SUPABASE_ANON_KEY, no per-user
-- sessions yet). `authenticated` is deliberately not granted here: add it
-- later, once Block 1 lands authenticated tenant-scoped access, if that
-- access path ends up needing to call this RPC directly.
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(
  UUID, UUID, INTEGER, TEXT, TEXT, BOOLEAN, UUID
) TO anon;
