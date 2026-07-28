-- Money / auth / notification bug sweep:
-- 1. HELD-DEP credits must not auto-activate pending leases
-- 2. Lease-end must not overwrite deposit_status partial → refunded
-- 3. Lock profile role + approval escalation
-- 4. Exclude HELD-DEP from rent revenue aggregates
-- 5. Unit-aware deposit capacity (multi-unit buildings)
-- 6. Validate deposit amount when converting booking → lease

-- -------------------------------------------------------
-- 1. activate_lease_on_payment_verified: ignore HELD-DEP credits
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.activate_lease_on_payment_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified')
     AND NEW.lease_id IS NOT NULL
     AND COALESCE(NEW.reference_code, '') NOT LIKE 'HELD-DEP-%'
  THEN
    UPDATE public.leases
    SET status = 'active'
    WHERE id = NEW.lease_id
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.activate_lease_on_payment_verified() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------
-- 2. settle_deposit_payment_on_lease_end: only auto-refund held
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_deposit_payment_on_lease_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('terminated', 'expired')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('terminated', 'expired') THEN
    UPDATE public.deposit_payments
    SET
      status = CASE
        WHEN status = 'verified' THEN 'settled'
        ELSE status
      END,
      notes = CASE
        WHEN status = 'verified' THEN COALESCE(notes, 'Settled on lease end')
        ELSE notes
      END
    WHERE lease_id = NEW.id
      AND status = 'verified';

    -- Preserve explicit partial (damage retention). Only auto-refund still-held deposits.
    IF NEW.deposit_status = 'held' THEN
      UPDATE public.leases
      SET deposit_status = 'refunded'
      WHERE id = NEW.id
        AND deposit_status = 'held';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_deposit_payment_on_lease_end() FROM PUBLIC;

-- -------------------------------------------------------
-- 3. Protect profile role + stop staff self-approval on insert
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.protect_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_jwt_role TEXT := COALESCE(auth.jwt()->>'role', '');
  v_has_invite BOOLEAN := false;
  v_invite_role TEXT;
  v_admin_exists BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_jwt_role = 'service_role' THEN
      IF NEW.account_status IS NULL OR NEW.account_status = '' THEN
        NEW.account_status := 'approved';
      END IF;
      RETURN NEW;
    END IF;

    IF private.is_admin() THEN
      IF NEW.role IN ('admin', 'finance', 'landlord') THEN
        NEW.account_status := COALESCE(NULLIF(NEW.account_status, ''), 'approved');
      ELSIF NEW.account_status IS NULL OR NEW.account_status = '' THEN
        NEW.account_status := 'pending';
      END IF;
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.user_invites
      WHERE lower(email) = lower(NEW.email)
        AND status = 'pending'
    ),
    (
      SELECT role
      FROM public.user_invites
      WHERE lower(email) = lower(NEW.email)
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    )
    INTO v_has_invite, v_invite_role;

    IF v_has_invite THEN
      IF v_invite_role IS NOT NULL THEN
        NEW.role := v_invite_role;
      END IF;
      NEW.account_status := 'approved';
      RETURN NEW;
    END IF;

    -- Bootstrap: first admin may self-provision once.
    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE role = 'admin'
    ) INTO v_admin_exists;

    IF NEW.role = 'admin' AND NOT v_admin_exists THEN
      NEW.account_status := 'approved';
      RETURN NEW;
    END IF;

    -- Authenticated self-signup: only client/tenant, always pending.
    IF NEW.role NOT IN ('client', 'tenant') THEN
      NEW.role := 'client';
    END IF;
    NEW.account_status := 'pending';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      IF current_setting('app.bypass_account_status', true) = 'on' THEN
        NULL;
      ELSIF NOT private.is_admin() THEN
        RAISE EXCEPTION 'Only admins can change account status'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
      IF current_setting('app.bypass_account_status', true) = 'on' THEN
        NULL;
      ELSIF private.is_admin() THEN
        NULL;
      ELSIF private.is_landlord()
            AND OLD.role = 'client'
            AND NEW.role = 'tenant' THEN
        NULL;
      ELSIF private.is_admin_or_finance()
            AND OLD.role = 'client'
            AND NEW.role = 'tenant' THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Not allowed to change profile role'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_account_status() FROM PUBLIC;

-- Self-update allowed for non-privileged columns; role/status guarded by trigger above.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT (auth.jwt()->>'sub')) = id)
  WITH CHECK ((SELECT (auth.jwt()->>'sub')) = id);

-- -------------------------------------------------------
-- 4. Exclude HELD-DEP from revenue aggregates
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
      SELECT SUM(amount)::numeric
      FROM public.payments
      WHERE status = 'verified'
        AND COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%'
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
    SELECT SUM(amount)::numeric
    FROM public.payments
    WHERE status = 'verified'
      AND COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%'
  ), 0) + COALESCE((
    SELECT SUM(amount)::numeric FROM public.property_purchases WHERE status = 'verified'
  ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verified_revenue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verified_revenue() TO authenticated;

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
  WHERE status = 'verified'
    AND COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%';

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
  v_deposits jsonb;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_rent
  FROM public.payments
  WHERE status = 'verified'
    AND COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%'
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
    AND COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%'
    AND (p_from IS NULL OR payment_date::date >= p_from)
    AND (p_to IS NULL OR payment_date::date <= p_to);

  SELECT COALESCE(SUM(amount)::numeric, 0) INTO v_pending_purchases
  FROM public.property_purchases
  WHERE status = 'pending'
    AND (p_from IS NULL OR created_at::date >= p_from)
    AND (p_to IS NULL OR created_at::date <= p_to);

  v_deposits := public.admin_deposit_stats();

  SELECT jsonb_build_object(
    'property', jsonb_build_object(
      'total', (SELECT COUNT(*)::int FROM public.properties),
      'available', (SELECT COUNT(*)::int FROM public.properties WHERE status = 'available'),
      'reserved', (SELECT COUNT(*)::int FROM public.properties WHERE status = 'reserved'),
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
      'deposits_held', (v_deposits->>'deposits_held')::numeric,
      'deposits_refunded', (v_deposits->>'deposits_refunded')::numeric,
      'deposits_retained', (v_deposits->>'deposits_retained')::numeric,
      'deposits_pending', (v_deposits->>'deposits_pending')::numeric,
      'total_expenses', COALESCE((
        SELECT SUM(amount)::numeric FROM public.expenses
        WHERE (p_from IS NULL OR incurred_on >= p_from)
          AND (p_to IS NULL OR incurred_on <= p_to)
      ), 0),
      'payments_count', COALESCE((
        SELECT COUNT(*)::int FROM public.payments
        WHERE COALESCE(reference_code, '') NOT LIKE 'HELD-DEP-%'
          AND (p_from IS NULL OR payment_date::date >= p_from)
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

-- -------------------------------------------------------
-- 5. Multi-unit deposit capacity helpers + RPCs
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.rental_deposit_free_slots(p_property_id UUID)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_units integer;
  v_leased_units integer;
  v_open_holds integer;
BEGIN
  SELECT COUNT(*)::int INTO v_units
  FROM public.units
  WHERE property_id = p_property_id;

  IF v_units = 0 THEN
    -- Whole-property listing: one open verified hold blocks further deposits.
    IF EXISTS (
      SELECT 1
      FROM public.leases
      WHERE property_id = p_property_id
        AND status IN ('pending', 'active')
    ) THEN
      RETURN 0;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.deposit_payments
      WHERE property_id = p_property_id
        AND status = 'verified'
        AND lease_id IS NULL
    ) THEN
      RETURN 0;
    END IF;
    RETURN 1;
  END IF;

  SELECT COUNT(*)::int INTO v_leased_units
  FROM public.units u
  WHERE u.property_id = p_property_id
    AND EXISTS (
      SELECT 1
      FROM public.leases l
      WHERE l.unit_id = u.id
        AND l.status IN ('pending', 'active')
    );

  SELECT COUNT(*)::int INTO v_open_holds
  FROM public.deposit_payments
  WHERE property_id = p_property_id
    AND status = 'verified'
    AND lease_id IS NULL;

  RETURN GREATEST(v_units - v_leased_units - v_open_holds, 0);
END;
$$;

REVOKE ALL ON FUNCTION private.rental_deposit_free_slots(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.rental_deposit_free_slots(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_rental_property_status(p_property_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_units integer;
  v_active integer;
  v_free integer;
BEGIN
  SELECT COUNT(*)::int INTO v_units
  FROM public.units
  WHERE property_id = p_property_id;

  SELECT COUNT(*)::int INTO v_active
  FROM public.leases
  WHERE property_id = p_property_id
    AND status = 'active';

  v_free := private.rental_deposit_free_slots(p_property_id);

  UPDATE public.properties AS p
  SET status = CASE
    WHEN v_units = 0 AND v_active > 0 THEN 'rented'
    WHEN v_units > 0 AND v_active >= v_units THEN 'rented'
    WHEN v_free <= 0 THEN 'reserved'
    WHEN EXISTS (
      SELECT 1
      FROM public.deposit_payments dp
      WHERE dp.property_id = p.id
        AND dp.status = 'verified'
        AND (
          dp.lease_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.leases l2
            WHERE l2.id = dp.lease_id AND l2.status = 'pending'
          )
        )
    ) OR EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.property_id = p.id AND l.status IN ('pending', 'active')
    ) THEN CASE
      WHEN v_units > 0 AND v_free > 0 THEN 'available'
      ELSE 'reserved'
    END
    ELSE 'available'
  END
  WHERE p.id = p_property_id
    AND p.type = 'rental';
END;
$$;

REVOKE ALL ON FUNCTION private.sync_rental_property_status(UUID) FROM PUBLIC;

DROP INDEX IF EXISTS public.deposit_payments_verified_property_uidx;

-- Keep uniqueness for whole-property (no units) verified holds only via RPC checks.
-- Partial unique index for properties without units is enforced in complete_deposit_payment.

CREATE OR REPLACE FUNCTION public.enforce_deposit_payment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
  v_status TEXT;
  v_price NUMERIC;
  v_free integer;
BEGIN
  SELECT type, status, price INTO v_type, v_status, v_price
  FROM public.properties
  WHERE id = NEW.property_id;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '23503';
  END IF;
  IF v_type <> 'rental' THEN
    RAISE EXCEPTION 'Only rental listings accept a booking deposit' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'sold' THEN
    RAISE EXCEPTION 'Property is not available for deposit' USING ERRCODE = '22023';
  END IF;

  v_free := private.rental_deposit_free_slots(NEW.property_id);
  IF v_free <= 0 THEN
    RAISE EXCEPTION 'Property is not available for deposit' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Property rent must be positive to compute deposit' USING ERRCODE = '22023';
  END IF;

  NEW.client_id := auth.jwt()->>'sub';
  NEW.amount := ROUND(v_price / 2.0, 2);
  NEW.status := 'pending';
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;
  NEW.lease_id := NULL;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Clients can submit deposit payments" ON public.deposit_payments;
CREATE POLICY "Clients can submit deposit payments" ON public.deposit_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id = (auth.jwt()->>'sub')
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = (auth.jwt()->>'sub')
        AND pr.account_status = 'approved'
    )
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id
        AND p.type = 'rental'
        AND p.status IN ('available', 'reserved', 'rented')
        AND private.rental_deposit_free_slots(p.id) > 0
    )
  );

CREATE OR REPLACE FUNCTION public.complete_deposit_payment(p_deposit_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_status TEXT;
  v_prop_type TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
  v_free integer;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can complete a deposit payment' USING ERRCODE = '42501';
  END IF;

  SELECT property_id, status
  INTO v_property_id, v_status
  FROM public.deposit_payments
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Deposit payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Deposit payment is not pending' USING ERRCODE = '22023';
  END IF;

  SELECT type
  INTO v_prop_type
  FROM public.properties
  WHERE id = v_property_id
  FOR UPDATE;

  IF v_prop_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_prop_type <> 'rental' THEN
    RAISE EXCEPTION 'Only rental listings can be reserved with a deposit' USING ERRCODE = '22023';
  END IF;

  v_free := private.rental_deposit_free_slots(v_property_id);
  IF v_free <= 0 THEN
    RAISE EXCEPTION 'Property is not available to reserve' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET
    status = 'verified',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now())
  WHERE id = p_deposit_id;

  -- Fail sibling pending deposits only when no slots remain after this verify.
  IF private.rental_deposit_free_slots(v_property_id) <= 0 THEN
    UPDATE public.deposit_payments
    SET status = 'failed'
    WHERE property_id = v_property_id
      AND status = 'pending'
      AND id <> p_deposit_id;
  END IF;

  PERFORM private.sync_rental_property_status(v_property_id);

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_deposit_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_deposit_payment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_deposit_payment(
  p_deposit_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_status TEXT;
  v_lease_id UUID;
  v_actor TEXT := auth.jwt()->>'sub';
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can release a deposit payment' USING ERRCODE = '42501';
  END IF;

  SELECT property_id, status, lease_id
  INTO v_property_id, v_status, v_lease_id
  FROM public.deposit_payments
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Deposit payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'verified' THEN
    RAISE EXCEPTION 'Only a verified deposit can be released' USING ERRCODE = '22023';
  END IF;
  IF v_lease_id IS NOT NULL THEN
    RAISE EXCEPTION 'Deposit is linked to a lease; settle the lease deposit instead' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET
    status = 'released',
    verified_by = COALESCE(verified_by, v_actor),
    verified_at = COALESCE(verified_at, timezone('utc'::text, now())),
    notes = COALESCE(NULLIF(trim(p_notes), ''), notes, 'Reservation released by staff')
  WHERE id = p_deposit_id;

  PERFORM private.sync_rental_property_status(v_property_id);

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_deposit_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_deposit_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_occupancy_from_lease()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_property uuid;
  unit_ids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_property := OLD.property_id;
    unit_ids := ARRAY_REMOVE(ARRAY[OLD.unit_id], NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    affected_property := COALESCE(NEW.property_id, OLD.property_id);
    unit_ids := ARRAY_REMOVE(ARRAY[OLD.unit_id, NEW.unit_id], NULL);
  ELSE
    affected_property := NEW.property_id;
    unit_ids := ARRAY_REMOVE(ARRAY[NEW.unit_id], NULL);
  END IF;

  IF cardinality(unit_ids) > 0 THEN
    UPDATE public.units AS u
    SET
      status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.leases AS l
          WHERE l.unit_id = u.id
            AND l.status = 'active'
        ) THEN 'occupied'
        ELSE 'vacant'
      END,
      tenant_id = (
        SELECT l.tenant_id
        FROM public.leases AS l
        WHERE l.unit_id = u.id
          AND l.status = 'active'
        ORDER BY l.start_date DESC
        LIMIT 1
      )
    WHERE u.id = ANY (unit_ids);
  END IF;

  IF affected_property IS NOT NULL THEN
    PERFORM private.sync_rental_property_status(affected_property);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------
-- 6. create_pending_lease_from_booking: validate deposit amount
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pending_lease_from_booking(
  p_client_id TEXT,
  p_property_id UUID,
  p_owner_id TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_rent_amount NUMERIC,
  p_unit_id UUID DEFAULT NULL,
  p_deposit_amount NUMERIC DEFAULT 0,
  p_booking_id UUID DEFAULT NULL,
  p_deposit_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_type TEXT;
  v_property_owner TEXT;
  v_landlord_role TEXT;
  v_client_role TEXT;
  v_deposit_status TEXT;
  v_deposit_amount NUMERIC;
  v_deposit_client TEXT;
  v_deposit_property UUID;
  v_deposit_row_status TEXT;
  v_lease_id UUID;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can create a lease from a booking'
      USING ERRCODE = '42501';
  END IF;

  IF p_client_id IS NULL OR length(trim(p_client_id)) = 0 THEN
    RAISE EXCEPTION 'Client is required' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NULL OR length(trim(p_owner_id)) = 0 THEN
    RAISE EXCEPTION 'Landlord is required' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid lease dates' USING ERRCODE = '22023';
  END IF;
  IF p_rent_amount IS NULL OR p_rent_amount <= 0 THEN
    RAISE EXCEPTION 'Rent amount must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_deposit_amount IS NULL OR p_deposit_amount < 0 THEN
    RAISE EXCEPTION 'Deposit amount cannot be negative' USING ERRCODE = '22023';
  END IF;

  SELECT type, owner_id
  INTO v_property_type, v_property_owner
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF v_property_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_property_type = 'sale' THEN
    RAISE EXCEPTION 'Cannot create a rental lease for a sale property'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_landlord_role
  FROM public.profiles
  WHERE id = p_owner_id;

  IF v_landlord_role IS NULL THEN
    RAISE EXCEPTION 'Landlord profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_landlord_role <> 'landlord' THEN
    RAISE EXCEPTION 'Selected owner must be a landlord' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_client_role
  FROM public.profiles
  WHERE id = p_client_id;

  IF v_client_role IS NULL THEN
    RAISE EXCEPTION 'Client profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_client_role NOT IN ('client', 'tenant') THEN
    RAISE EXCEPTION 'Lease tenant must be a client or tenant profile'
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.units
      WHERE id = p_unit_id AND property_id = p_property_id
    ) THEN
      RAISE EXCEPTION 'Unit does not belong to this property' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_deposit_amount := COALESCE(p_deposit_amount, 0);

  IF p_deposit_id IS NOT NULL THEN
    SELECT client_id, property_id, status, amount
    INTO v_deposit_client, v_deposit_property, v_deposit_row_status, v_deposit_amount
    FROM public.deposit_payments
    WHERE id = p_deposit_id
    FOR UPDATE;

    IF v_deposit_client IS NULL THEN
      RAISE EXCEPTION 'Deposit payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_deposit_row_status <> 'verified' THEN
      RAISE EXCEPTION 'Deposit payment must be verified' USING ERRCODE = '22023';
    END IF;
    IF v_deposit_client <> p_client_id OR v_deposit_property <> p_property_id THEN
      RAISE EXCEPTION 'Deposit and lease client/property mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_owner_id IS DISTINCT FROM v_property_owner THEN
    UPDATE public.properties
    SET owner_id = p_owner_id
    WHERE id = p_property_id;
  END IF;

  IF v_deposit_amount > 0 AND p_deposit_id IS NOT NULL THEN
    v_deposit_status := 'held';
  ELSIF v_deposit_amount > 0 THEN
    v_deposit_status := 'due';
  ELSE
    v_deposit_status := 'none';
  END IF;

  INSERT INTO public.leases (
    property_id,
    unit_id,
    tenant_id,
    owner_id,
    start_date,
    end_date,
    rent_amount,
    deposit_amount,
    deposit_status,
    status
  )
  VALUES (
    p_property_id,
    p_unit_id,
    p_client_id,
    p_owner_id,
    p_start_date,
    p_end_date,
    p_rent_amount,
    COALESCE(v_deposit_amount, 0),
    v_deposit_status,
    'pending'
  )
  RETURNING id INTO v_lease_id;

  IF p_deposit_id IS NOT NULL THEN
    PERFORM public.link_deposit_payment_to_lease(p_deposit_id, v_lease_id);
  END IF;

  UPDATE public.profiles
  SET role = 'tenant'
  WHERE id = p_client_id
    AND role = 'client';

  IF p_booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET status = 'completed'
    WHERE id = p_booking_id
      AND client_id = p_client_id
      AND property_id = p_property_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking not found or does not match client/property'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM private.sync_rental_property_status(p_property_id);

  RETURN v_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_lease_from_booking(
  TEXT, UUID, TEXT, DATE, DATE, NUMERIC, UUID, NUMERIC, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pending_lease_from_booking(
  TEXT, UUID, TEXT, DATE, DATE, NUMERIC, UUID, NUMERIC, UUID, UUID
) TO authenticated;
