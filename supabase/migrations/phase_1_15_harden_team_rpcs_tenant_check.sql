-- phase_1_15_harden_team_rpcs_tenant_check
--
-- Applied live via the Supabase MCP `apply_migration` tool on 2026-08-18,
-- as part of the full systems audit's Phase A security-fix pass (item A3).
--
-- get_tenant_members(p_tenant_id) and get_user_id_by_email(p_email) are
-- SECURITY DEFINER RPCs that had EXECUTE granted to PUBLIC/anon/authenticated
-- with no internal check of their own — controllers/team.js's own docblock
-- already flagged this as deferred, known debt ("the RPC-layer leak...
-- remains and is deferred to Block 1.7, not fixed here"). Anyone could call
-- either directly against the REST endpoint: get_tenant_members with any
-- tenant UUID returned that tenant's member emails + user IDs; get_user_id_by_email
-- was a bare unauthenticated email -> auth.users.id enumeration oracle.
--
-- Fix: require an authenticated caller for both (revoke anon/PUBLIC EXECUTE),
-- and additionally verify inside get_tenant_members that the caller is
-- actually a member of the tenant they're asking about, so it's safe even if
-- invoked directly via PostgREST rather than through controllers/team.js's
-- route (which already calls both via req.supabase, an authenticated,
-- JWT-seeded client, so this is not a behavior change for that real caller —
-- only for an anon or cross-tenant caller).

CREATE OR REPLACE FUNCTION public.get_tenant_members(p_tenant_id uuid)
 RETURNS TABLE(user_id uuid, email text, role text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_tenant_members requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenants ut2
    WHERE ut2.user_id = auth.uid() AND ut2.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'caller is not a member of tenant %', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ut.user_id, u.email::text, ut.role, ut.created_at
  FROM public.user_tenants ut
  JOIN auth.users u ON u.id = ut.user_id
  WHERE ut.tenant_id = p_tenant_id
  ORDER BY ut.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_user_id_by_email requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  RETURN (SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_members(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;
