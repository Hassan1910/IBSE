-- Full expenses sum for finances summary (mirrors admin_verified_revenue)
CREATE OR REPLACE FUNCTION public.admin_total_expenses()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT SUM(amount)::numeric FROM public.expenses
  ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_total_expenses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_total_expenses() TO authenticated;
