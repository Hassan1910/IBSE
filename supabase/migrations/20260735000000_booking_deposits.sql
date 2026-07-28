-- Booking security deposit: half monthly rent, proof → verify → reserve property.
-- Deposit is held for damage; refunded or partially settled on tenancy end.
-- Not rent revenue — tracked separately as deposit liability.

-- -------------------------------------------------------
-- 1. properties.status includes reserved
-- -------------------------------------------------------
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_status_check
  CHECK (status IN ('available', 'reserved', 'rented', 'sold'));

-- -------------------------------------------------------
-- 2. deposit_payments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deposit_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'bank', 'cash')),
  reference_code TEXT NOT NULL,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed')),
  notes TEXT,
  verified_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT deposit_payments_reference_code_key UNIQUE (reference_code)
);

CREATE INDEX IF NOT EXISTS deposit_payments_client_id_idx
  ON public.deposit_payments (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deposit_payments_property_id_idx
  ON public.deposit_payments (property_id, status);

CREATE INDEX IF NOT EXISTS deposit_payments_pending_idx
  ON public.deposit_payments (status, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS deposit_payments_lease_id_idx
  ON public.deposit_payments (lease_id)
  WHERE lease_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS deposit_payments_pending_client_property_uidx
  ON public.deposit_payments (property_id, client_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS deposit_payments_verified_property_uidx
  ON public.deposit_payments (property_id)
  WHERE status = 'verified';

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
  IF v_status <> 'available' THEN
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

DROP TRIGGER IF EXISTS trg_enforce_deposit_payment_insert ON public.deposit_payments;
CREATE TRIGGER trg_enforce_deposit_payment_insert
  BEFORE INSERT ON public.deposit_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_deposit_payment_insert();

ALTER TABLE public.deposit_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.deposit_payments TO authenticated;

DROP POLICY IF EXISTS "Clients can view own deposit payments" ON public.deposit_payments;
CREATE POLICY "Clients can view own deposit payments" ON public.deposit_payments
  FOR SELECT TO authenticated
  USING (client_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Staff can view all deposit payments" ON public.deposit_payments;
CREATE POLICY "Staff can view all deposit payments" ON public.deposit_payments
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

DROP POLICY IF EXISTS "Landlords can view deposits on owned properties" ON public.deposit_payments;
CREATE POLICY "Landlords can view deposits on owned properties" ON public.deposit_payments
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_landlord())
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = deposit_payments.property_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

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
        AND p.status = 'available'
    )
  );

DROP POLICY IF EXISTS "Staff can update deposit payments" ON public.deposit_payments;
CREATE POLICY "Staff can update deposit payments" ON public.deposit_payments
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin_or_finance()))
  WITH CHECK ((SELECT private.is_admin_or_finance()));

-- -------------------------------------------------------
-- 3. complete / reject deposit payment
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_deposit_payment(p_deposit_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_status TEXT;
  v_prop_status TEXT;
  v_prop_type TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
  v_reserved INT := 0;
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

  SELECT type, status
  INTO v_prop_type, v_prop_status
  FROM public.properties
  WHERE id = v_property_id
  FOR UPDATE;

  IF v_prop_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_prop_type <> 'rental' THEN
    RAISE EXCEPTION 'Only rental listings can be reserved with a deposit' USING ERRCODE = '22023';
  END IF;
  IF v_prop_status <> 'available' THEN
    RAISE EXCEPTION 'Property is not available to reserve' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET
    status = 'verified',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now())
  WHERE id = p_deposit_id;

  UPDATE public.properties
  SET status = 'reserved'
  WHERE id = v_property_id
    AND type = 'rental'
    AND status = 'available';

  GET DIAGNOSTICS v_reserved = ROW_COUNT;
  IF v_reserved <> 1 THEN
    RAISE EXCEPTION 'Could not reserve property for deposit' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET status = 'failed'
  WHERE property_id = v_property_id
    AND status = 'pending'
    AND id <> p_deposit_id;

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_deposit_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_deposit_payment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_deposit_payment(
  p_deposit_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can reject a deposit payment' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
  FROM public.deposit_payments
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Deposit payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Deposit payment is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET
    status = 'failed',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now()),
    notes = COALESCE(NULLIF(trim(p_notes), ''), notes)
  WHERE id = p_deposit_id;

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_deposit_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_deposit_payment(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 4. Link verified deposit to a new lease
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_deposit_payment_to_lease(
  p_deposit_id UUID,
  p_lease_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client TEXT;
  v_property UUID;
  v_status TEXT;
  v_lease_id UUID;
  v_lease_tenant TEXT;
  v_lease_property UUID;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can link a deposit to a lease' USING ERRCODE = '42501';
  END IF;

  SELECT client_id, property_id, status, lease_id
  INTO v_client, v_property, v_status, v_lease_id
  FROM public.deposit_payments
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Deposit payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'verified' THEN
    RAISE EXCEPTION 'Deposit payment must be verified' USING ERRCODE = '22023';
  END IF;
  IF v_lease_id IS NOT NULL THEN
    IF v_lease_id = p_lease_id THEN
      RETURN p_deposit_id;
    END IF;
    RAISE EXCEPTION 'Deposit is already linked to a lease' USING ERRCODE = '22023';
  END IF;

  SELECT tenant_id, property_id
  INTO v_lease_tenant, v_lease_property
  FROM public.leases
  WHERE id = p_lease_id;

  IF v_lease_tenant IS NULL THEN
    RAISE EXCEPTION 'Lease not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_lease_tenant <> v_client OR v_lease_property <> v_property THEN
    RAISE EXCEPTION 'Deposit and lease client/property mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deposit_payments
  SET lease_id = p_lease_id
  WHERE id = p_deposit_id;

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_deposit_payment_to_lease(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_deposit_payment_to_lease(UUID, UUID) TO authenticated;

-- -------------------------------------------------------
-- 5. Settle lease deposit on exit (refund / damage)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_lease_deposit(
  p_lease_id UUID,
  p_outcome TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_amount NUMERIC;
  v_owner TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
  v_is_staff BOOLEAN;
  v_is_owner BOOLEAN;
BEGIN
  IF p_outcome NOT IN ('refunded', 'partial') THEN
    RAISE EXCEPTION 'Outcome must be refunded or partial' USING ERRCODE = '22023';
  END IF;

  SELECT l.deposit_status, l.deposit_amount, p.owner_id
  INTO v_status, v_amount, v_owner
  FROM public.leases l
  JOIN public.properties p ON p.id = l.property_id
  WHERE l.id = p_lease_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lease not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_staff := (SELECT private.is_admin_or_finance());
  v_is_owner := (
    (SELECT private.is_landlord())
    AND v_owner IS NOT NULL
    AND v_owner = v_actor
  );

  IF NOT (v_is_staff OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to settle this deposit' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Lease has no deposit to settle' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('held', 'partial') THEN
    RAISE EXCEPTION 'Deposit must be held (or partial) before settle' USING ERRCODE = '22023';
  END IF;

  UPDATE public.leases
  SET
    deposit_status = p_outcome,
    terms = CASE
      WHEN NULLIF(trim(COALESCE(p_notes, '')), '') IS NULL THEN terms
      ELSE trim(
        COALESCE(terms, '') ||
        CASE WHEN COALESCE(terms, '') = '' THEN '' ELSE E'\n' END ||
        format('[%s] Deposit %s: %s', timezone('utc', now())::date, p_outcome, trim(p_notes))
      )
    END
  WHERE id = p_lease_id;

  RETURN p_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_lease_deposit(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_lease_deposit(UUID, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 6. Seed lease charges: mark deposit paid when already held
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.seed_lease_charges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rent_total numeric;
  months int;
  deposit_charge_status text;
  held_ref text;
BEGIN
  months := private.lease_month_count(NEW.start_date, NEW.end_date);
  rent_total := COALESCE(NEW.rent_amount, 0) * months;

  INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
  VALUES (
    NEW.id,
    'rent',
    format('Rent for %s months', months),
    rent_total,
    NEW.start_date,
    'open'
  );

  IF COALESCE(NEW.deposit_amount, 0) > 0 THEN
    deposit_charge_status := CASE
      WHEN NEW.deposit_status = 'held' THEN 'paid'
      ELSE 'open'
    END;

    INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
    VALUES (
      NEW.id,
      'deposit',
      'Security deposit',
      NEW.deposit_amount,
      NEW.start_date,
      deposit_charge_status
    );

    IF NEW.deposit_status = 'held' THEN
      held_ref := 'HELD-DEP-' || replace(NEW.id::text, '-', '');
      INSERT INTO public.payments (
        lease_id,
        payer_id,
        amount,
        payment_method,
        reference_code,
        status
      )
      VALUES (
        NEW.id,
        NEW.tenant_id,
        NEW.deposit_amount,
        'cash',
        held_ref,
        'verified'
      )
      ON CONFLICT (reference_code) DO NOTHING;
    END IF;

    IF NEW.deposit_status = 'none' THEN
      UPDATE public.leases SET deposit_status = 'due' WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------
-- 7. Occupancy sync preserves reserved when verified deposit
-- -------------------------------------------------------
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
    UPDATE public.properties AS p
    SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.leases AS l
        WHERE l.property_id = p.id
          AND l.status = 'active'
      ) THEN 'rented'
      WHEN EXISTS (
        SELECT 1
        FROM public.deposit_payments AS dp
        WHERE dp.property_id = p.id
          AND dp.status = 'verified'
          AND (
            dp.lease_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.leases AS l2
              WHERE l2.id = dp.lease_id
                AND l2.status = 'pending'
            )
          )
      ) THEN 'reserved'
      ELSE 'available'
    END
    WHERE p.id = affected_property
      AND p.type = 'rental';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------
-- 8. Notification type
-- -------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'rent_due',
      'payment_confirmed',
      'payment_submitted',
      'maintenance_update',
      'lease_expiry',
      'announcement',
      'feedback_reply',
      'booking_update',
      'message',
      'landlord_request',
      'purchase_update',
      'account_approval',
      'deposit_update'
    )
  );

-- -------------------------------------------------------
-- 9. Deposit stats (liability — not revenue)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_deposit_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_held numeric;
  v_refunded numeric;
  v_retained numeric;
  v_pending numeric;
  v_pending_count int;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Held on active/pending leases + verified booking deposits not yet linked to a lease
  SELECT COALESCE(SUM(deposit_amount)::numeric, 0) INTO v_held
  FROM public.leases
  WHERE deposit_status = 'held'
    AND COALESCE(deposit_amount, 0) > 0;

  SELECT v_held + COALESCE(SUM(dp.amount)::numeric, 0) INTO v_held
  FROM public.deposit_payments dp
  WHERE dp.status = 'verified'
    AND dp.lease_id IS NULL;

  SELECT COALESCE(SUM(deposit_amount)::numeric, 0) INTO v_refunded
  FROM public.leases
  WHERE deposit_status = 'refunded';

  SELECT COALESCE(SUM(deposit_amount)::numeric, 0) INTO v_retained
  FROM public.leases
  WHERE deposit_status = 'partial';

  SELECT COALESCE(SUM(amount)::numeric, 0), COUNT(*)::int
  INTO v_pending, v_pending_count
  FROM public.deposit_payments
  WHERE status = 'pending';

  RETURN jsonb_build_object(
    'deposits_held', v_held,
    'deposits_refunded', v_refunded,
    'deposits_retained', v_retained,
    'deposits_pending', v_pending,
    'deposits_pending_count', v_pending_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_deposit_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_deposit_stats() TO authenticated;

-- Include reserved in report property counts + deposit block
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
