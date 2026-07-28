-- Finance payment approval gaps:
-- 1. notify_admins / notify_for_property fallback include finance officers
-- 2. Verified revenue aggregates include property purchases

-- -------------------------------------------------------
-- 1. Notify admin AND finance
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT := auth.jwt()->>'sub';
  v_role TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'finance', 'landlord', 'tenant', 'client') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
  FROM public.profiles
  WHERE role IN ('admin', 'finance');
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- When a property has no owner, fall back to admin + finance (not admin only).
CREATE OR REPLACE FUNCTION public.notify_for_property(
  p_property_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT := auth.jwt()->>'sub';
  v_owner TEXT;
  v_role TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller;

  IF v_role NOT IN ('admin', 'finance', 'landlord', 'tenant', 'client') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('tenant', 'client') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.leases
      WHERE tenant_id = v_caller
        AND property_id = p_property_id
        AND status IN ('pending', 'active')
    ) THEN
      RAISE EXCEPTION 'Not allowed for this property' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.properties
  WHERE id = p_property_id;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES (v_owner, p_type, p_title, p_body, p_entity_type, p_entity_id);
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
    FROM public.profiles
    WHERE role IN ('admin', 'finance');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_for_property(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_for_property(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 2. Revenue aggregates include verified purchases
-- -------------------------------------------------------
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
    ), 0) + COALESCE((
      SELECT SUM(amount)::numeric FROM public.property_purchases WHERE status = 'verified'
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

-- Total verified revenue (rent + purchases) — keeps numeric return for existing callers
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
  ), 0) + COALESCE((
    SELECT SUM(amount)::numeric FROM public.property_purchases WHERE status = 'verified'
  ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verified_revenue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verified_revenue() TO authenticated;

-- Rent vs purchase split for Finances screen
CREATE OR REPLACE FUNCTION public.admin_revenue_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rent numeric;
  v_purchases numeric;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_rent
  FROM public.payments
  WHERE status = 'verified';

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_purchases
  FROM public.property_purchases
  WHERE status = 'verified';

  RETURN jsonb_build_object(
    'rent_revenue', v_rent,
    'purchase_revenue', v_purchases,
    'total_revenue', v_rent + v_purchases
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_breakdown() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_revenue_breakdown() TO authenticated;

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
  v_rent numeric;
  v_purchases numeric;
  v_pending_rent numeric;
  v_pending_purchases numeric;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_rent
  FROM public.payments
  WHERE status = 'verified'
    AND (p_from IS NULL OR payment_date::date >= p_from)
    AND (p_to IS NULL OR payment_date::date <= p_to);

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_purchases
  FROM public.property_purchases
  WHERE status = 'verified'
    AND (p_from IS NULL OR created_at::date >= p_from)
    AND (p_to IS NULL OR created_at::date <= p_to);

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_pending_rent
  FROM public.payments
  WHERE status = 'pending'
    AND (p_from IS NULL OR payment_date::date >= p_from)
    AND (p_to IS NULL OR payment_date::date <= p_to);

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_pending_purchases
  FROM public.property_purchases
  WHERE status = 'pending'
    AND (p_from IS NULL OR created_at::date >= p_from)
    AND (p_to IS NULL OR created_at::date <= p_to);

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
      'rent_revenue', v_rent,
      'purchase_revenue', v_purchases,
      'verified_revenue', v_rent + v_purchases,
      'pending_amount', v_pending_rent + v_pending_purchases,
      'pending_rent', v_pending_rent,
      'pending_purchases', v_pending_purchases,
      'total_expenses', COALESCE((
        SELECT SUM(amount)::numeric FROM public.expenses
        WHERE (p_from IS NULL OR incurred_on >= p_from)
          AND (p_to IS NULL OR incurred_on <= p_to)
      ), 0),
      'payments_count', COALESCE((
        SELECT COUNT(*)::int FROM public.payments
        WHERE (p_from IS NULL OR payment_date::date >= p_from)
          AND (p_to IS NULL OR payment_date::date <= p_to)
      ), 0),
      'purchases_count', COALESCE((
        SELECT COUNT(*)::int FROM public.property_purchases
        WHERE (p_from IS NULL OR created_at::date >= p_from)
          AND (p_to IS NULL OR created_at::date <= p_to)
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
