-- Align landlord dashboard money metrics with report ownership model:
-- - monthly_income includes pending + active leases (expected rent)
-- - verified/pending payment sums are not limited to currently active leases

CREATE OR REPLACE FUNCTION public.landlord_dashboard_stats(p_owner_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller text := (auth.jwt()->>'sub');
  occupied_units int := 0;
  vacant_units int := 0;
  total_tenants int := 0;
  monthly_income numeric := 0;
  verified_collected numeric := 0;
  pending_payments numeric := 0;
  prop_count int := 0;
BEGIN
  IF caller IS NULL OR caller <> p_owner_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (SELECT private.is_landlord()) AND NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO prop_count
  FROM public.properties
  WHERE owner_id = p_owner_id;

  -- Unit inventory counts
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE u.status = 'occupied'), 0)::int,
    COALESCE(COUNT(*) FILTER (WHERE u.status = 'vacant'), 0)::int
  INTO occupied_units, vacant_units
  FROM public.units u
  WHERE u.property_id IN (SELECT id FROM public.properties WHERE owner_id = p_owner_id);

  -- Unitless properties: occupied if they have an active lease
  SELECT
    occupied_units + COALESCE(COUNT(*) FILTER (WHERE leased), 0)::int,
    vacant_units + COALESCE(COUNT(*) FILTER (WHERE NOT leased), 0)::int
  INTO occupied_units, vacant_units
  FROM (
    SELECT p.id,
      EXISTS (
        SELECT 1 FROM public.leases l
        WHERE l.property_id = p.id AND l.status = 'active'
      ) AS leased
    FROM public.properties p
    WHERE p.owner_id = p_owner_id
      AND NOT EXISTS (SELECT 1 FROM public.units u WHERE u.property_id = p.id)
  ) unitless;

  SELECT
    COALESCE(COUNT(DISTINCT l.tenant_id) FILTER (WHERE l.status = 'active'), 0)::int,
    COALESCE(SUM(l.rent_amount) FILTER (WHERE l.status IN ('pending', 'active')), 0)
  INTO total_tenants, monthly_income
  FROM public.leases l
  WHERE l.status IN ('pending', 'active')
    AND l.property_id IN (SELECT id FROM public.properties WHERE owner_id = p_owner_id);

  SELECT
    COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'verified'), 0),
    COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'pending'), 0)
  INTO verified_collected, pending_payments
  FROM public.payments pay
  JOIN public.leases l ON l.id = pay.lease_id
  JOIN public.properties p ON p.id = l.property_id
  WHERE p.owner_id = p_owner_id;

  RETURN jsonb_build_object(
    'total_properties', prop_count,
    'occupied_units', occupied_units,
    'vacant_units', vacant_units,
    'total_tenants', total_tenants,
    'monthly_income', monthly_income,
    'verified_collected', verified_collected,
    'pending_payments', pending_payments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.landlord_dashboard_stats(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.landlord_dashboard_stats(text) TO authenticated;
