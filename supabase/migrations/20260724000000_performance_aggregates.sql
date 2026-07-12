-- Aggregate RPCs so dashboards/reports do not download full tables into the client.

-- =======================================================
-- Admin / finance dashboard stats
-- =======================================================
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE((
      SELECT SUM(amount)::numeric FROM public.payments WHERE status = 'verified'
    ), 0),
    'active_leases', COALESCE((
      SELECT COUNT(*)::int FROM public.leases WHERE status = 'active'
    ), 0),
    'pending_bookings', COALESCE((
      SELECT COUNT(*)::int FROM public.bookings WHERE status = 'pending'
    ), 0),
    'open_maintenance', COALESCE((
      SELECT COUNT(*)::int FROM public.maintenance_requests WHERE status <> 'resolved'
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;

-- Single verified-revenue sum for finances screens
CREATE OR REPLACE FUNCTION public.admin_verified_revenue()
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
    SELECT SUM(amount)::numeric FROM public.payments WHERE status = 'verified'
  ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verified_revenue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verified_revenue() TO authenticated;

-- =======================================================
-- Admin report summary (optional date filters on payments/expenses)
-- =======================================================
CREATE OR REPLACE FUNCTION public.admin_report_summary(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'property', jsonb_build_object(
      'total', (SELECT COUNT(*)::int FROM public.properties),
      'available', (SELECT COUNT(*)::int FROM public.properties WHERE status = 'available'),
      'rented', (SELECT COUNT(*)::int FROM public.properties WHERE status = 'rented'),
      'sold', (SELECT COUNT(*)::int FROM public.properties WHERE status = 'sold'),
      'residential', (SELECT COUNT(*)::int FROM public.properties WHERE category = 'residential'),
      'commercial', (SELECT COUNT(*)::int FROM public.properties WHERE category = 'commercial'),
      'land', (SELECT COUNT(*)::int FROM public.properties WHERE category = 'land'),
      'rental_units', (SELECT COUNT(*)::int FROM public.properties WHERE type = 'rental')
    ),
    'financial', jsonb_build_object(
      'verified_revenue', COALESCE((
        SELECT SUM(amount)::numeric FROM public.payments
        WHERE status = 'verified'
          AND (p_from IS NULL OR payment_date::date >= p_from)
          AND (p_to IS NULL OR payment_date::date <= p_to)
      ), 0),
      'pending_amount', COALESCE((
        SELECT SUM(amount)::numeric FROM public.payments
        WHERE status = 'pending'
          AND (p_from IS NULL OR payment_date::date >= p_from)
          AND (p_to IS NULL OR payment_date::date <= p_to)
      ), 0),
      'total_expenses', COALESCE((
        SELECT SUM(amount)::numeric FROM public.expenses
        WHERE (p_from IS NULL OR incurred_on >= p_from)
          AND (p_to IS NULL OR incurred_on <= p_to)
      ), 0),
      'payments_count', COALESCE((
        SELECT COUNT(*)::int FROM public.payments
        WHERE (p_from IS NULL OR payment_date::date >= p_from)
          AND (p_to IS NULL OR payment_date::date <= p_to)
      ), 0)
    ),
    'occupancy', jsonb_build_object(
      'active_leases', (SELECT COUNT(*)::int FROM public.leases WHERE status = 'active'),
      'open_maintenance', (
        SELECT COUNT(*)::int FROM public.maintenance_requests WHERE status <> 'resolved'
      )
    ),
    'users', jsonb_build_object(
      'total', (SELECT COUNT(*)::int FROM public.profiles),
      'admin', (SELECT COUNT(*)::int FROM public.profiles WHERE role = 'admin'),
      'finance', (SELECT COUNT(*)::int FROM public.profiles WHERE role = 'finance'),
      'landlord', (SELECT COUNT(*)::int FROM public.profiles WHERE role = 'landlord'),
      'tenant', (SELECT COUNT(*)::int FROM public.profiles WHERE role = 'tenant'),
      'client', (SELECT COUNT(*)::int FROM public.profiles WHERE role = 'client'),
      'new_30_days', (
        SELECT COUNT(*)::int FROM public.profiles
        WHERE created_at >= (timezone('utc', now()) - interval '30 days')
      )
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_summary(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_report_summary(date, date) TO authenticated;

-- =======================================================
-- Landlord dashboard stats (scoped to caller; p_owner_id must match JWT)
-- =======================================================
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
    COALESCE(COUNT(DISTINCT l.tenant_id), 0)::int,
    COALESCE(SUM(l.rent_amount), 0)
  INTO total_tenants, monthly_income
  FROM public.leases l
  WHERE l.status = 'active'
    AND l.property_id IN (SELECT id FROM public.properties WHERE owner_id = p_owner_id);

  SELECT
    COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'verified'), 0),
    COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'pending'), 0)
  INTO verified_collected, pending_payments
  FROM public.payments pay
  WHERE pay.lease_id IN (
    SELECT l.id FROM public.leases l
    WHERE l.status IN ('pending', 'active')
      AND l.property_id IN (SELECT id FROM public.properties WHERE owner_id = p_owner_id)
  );

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
