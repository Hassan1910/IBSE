-- Allow notify_admins to target a subset of staff roles (e.g. admin-only
-- for account_approval). Default remains admin + finance for existing callers.

DROP FUNCTION IF EXISTS public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL,
  p_roles TEXT[] DEFAULT ARRAY['admin', 'finance']::TEXT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT := auth.jwt()->>'sub';
  v_role TEXT;
  v_roles TEXT[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'finance', 'landlord', 'tenant', 'client') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Only admin/finance may be notified via this helper.
  SELECT COALESCE(array_agg(r), ARRAY[]::TEXT[])
  INTO v_roles
  FROM unnest(COALESCE(p_roles, ARRAY['admin', 'finance']::TEXT[])) AS r
  WHERE r IN ('admin', 'finance');

  IF cardinality(v_roles) = 0 THEN
    RAISE EXCEPTION 'No valid notification roles' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
  FROM public.profiles
  WHERE role = ANY (v_roles);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
