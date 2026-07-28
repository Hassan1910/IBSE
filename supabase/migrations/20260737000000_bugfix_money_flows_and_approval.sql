-- Bugfixes: held-deposit double-charge, reservation integrity, approval on INSERT,
-- purchase amount lock, link guard, lease-end deposit_status, purchase-doc ACL,
-- and atomic terminate+settle.

-- -------------------------------------------------------
-- 0. Ensure terminal deposit statuses (needed by settle/release paths)
-- -------------------------------------------------------
ALTER TABLE public.deposit_payments
  DROP CONSTRAINT IF EXISTS deposit_payments_status_check;

ALTER TABLE public.deposit_payments
  ADD CONSTRAINT deposit_payments_status_check
  CHECK (status IN ('pending', 'verified', 'failed', 'released', 'settled'));

DROP INDEX IF EXISTS public.deposit_payments_verified_property_uidx;
CREATE UNIQUE INDEX deposit_payments_verified_property_uidx
  ON public.deposit_payments (property_id)
  WHERE status = 'verified';

-- Settle linked deposit_payments when lease deposit is settled (remote was missing this).
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

  UPDATE public.deposit_payments
  SET
    status = 'settled',
    notes = COALESCE(
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      notes,
      format('Settled as %s', p_outcome)
    )
  WHERE lease_id = p_lease_id
    AND status = 'verified';

  RETURN p_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_lease_deposit(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_lease_deposit(UUID, TEXT, TEXT) TO authenticated;

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

  UPDATE public.properties AS p
  SET status = CASE
    WHEN EXISTS (
      SELECT 1 FROM public.leases AS l
      WHERE l.property_id = p.id AND l.status = 'active'
    ) THEN 'rented'
    WHEN EXISTS (
      SELECT 1 FROM public.deposit_payments AS dp
      WHERE dp.property_id = p.id
        AND dp.status = 'verified'
        AND (
          dp.lease_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.leases AS l2
            WHERE l2.id = dp.lease_id AND l2.status = 'pending'
          )
        )
    ) THEN 'reserved'
    ELSE 'available'
  END
  WHERE p.id = v_property_id
    AND p.type = 'rental';

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_deposit_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_deposit_payment(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Staff can update deposit payments" ON public.deposit_payments;
DROP POLICY IF EXISTS "Staff can update purchases" ON public.property_purchases;

UPDATE storage.buckets
SET public = false
WHERE id = 'purchase-documents';

-- -------------------------------------------------------
-- 1. seed_lease_charges: credit a verified payment for pre-held deposits
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

    -- Match lease_balance (charges − verified payments): a "paid" deposit charge
    -- without a payment row would leave the deposit in outstanding.
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
-- 2. complete_deposit_payment: require successful reservation
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

-- -------------------------------------------------------
-- 3. complete_property_purchase: require available → sold
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_property_purchase(p_purchase_id UUID)
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
  v_sold INT := 0;
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can complete a purchase' USING ERRCODE = '42501';
  END IF;

  SELECT property_id, status
  INTO v_property_id, v_status
  FROM public.property_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Purchase is not pending' USING ERRCODE = '22023';
  END IF;

  SELECT type, status
  INTO v_prop_type, v_prop_status
  FROM public.properties
  WHERE id = v_property_id
  FOR UPDATE;

  IF v_prop_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_prop_type <> 'sale' THEN
    RAISE EXCEPTION 'Only sale listings can be marked sold via purchase' USING ERRCODE = '22023';
  END IF;
  IF v_prop_status <> 'available' THEN
    RAISE EXCEPTION 'Property is not available for sale completion' USING ERRCODE = '22023';
  END IF;

  UPDATE public.property_purchases
  SET
    status = 'verified',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now())
  WHERE id = p_purchase_id;

  UPDATE public.properties
  SET status = 'sold'
  WHERE id = v_property_id
    AND type = 'sale'
    AND status = 'available';

  GET DIAGNOSTICS v_sold = ROW_COUNT;
  IF v_sold <> 1 THEN
    RAISE EXCEPTION 'Could not mark property as sold' USING ERRCODE = '22023';
  END IF;

  UPDATE public.property_purchases
  SET status = 'failed'
  WHERE property_id = v_property_id
    AND status = 'pending'
    AND id <> p_purchase_id;

  RETURN p_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_property_purchase(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_property_purchase(UUID) TO authenticated;

-- -------------------------------------------------------
-- 4. link_deposit_payment_to_lease: refuse re-linking
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
-- 5. Approval gate on deposit / purchase INSERT policies
-- -------------------------------------------------------
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

DROP POLICY IF EXISTS "Buyers can submit purchases" ON public.property_purchases;
CREATE POLICY "Buyers can submit purchases" ON public.property_purchases
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id = (auth.jwt()->>'sub')
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = (auth.jwt()->>'sub')
        AND pr.account_status = 'approved'
    )
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id
        AND p.type = 'sale'
        AND p.status = 'available'
    )
  );

-- -------------------------------------------------------
-- 6. Lock purchase amount to listing price
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_property_purchase_insert()
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
  IF v_type <> 'sale' THEN
    RAISE EXCEPTION 'Only sale listings can be purchased' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Property is not available for purchase' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Property has no valid sale price' USING ERRCODE = '22023';
  END IF;

  NEW.buyer_id := auth.jwt()->>'sub';
  NEW.amount := v_price;
  NEW.status := 'pending';
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------
-- 7. Lease-end: settle payment rows AND leases.deposit_status
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

    -- Only touch deposit_status when terminal statuses exist on the column check.
    IF NEW.deposit_status IN ('held', 'partial') THEN
      UPDATE public.leases
      SET deposit_status = 'refunded'
      WHERE id = NEW.id
        AND deposit_status IN ('held', 'partial');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure trigger exists (noop if 360 already created it).
DROP TRIGGER IF EXISTS trg_settle_deposit_payment_on_lease_end ON public.leases;
CREATE TRIGGER trg_settle_deposit_payment_on_lease_end
  AFTER UPDATE OF status ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_deposit_payment_on_lease_end();

REVOKE ALL ON FUNCTION public.settle_deposit_payment_on_lease_end() FROM PUBLIC;

-- -------------------------------------------------------
-- 8. Atomic terminate + optional deposit settle
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.terminate_lease_with_deposit(
  p_lease_id UUID,
  p_outcome TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_owner TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
  v_is_staff BOOLEAN;
  v_is_owner BOOLEAN;
BEGIN
  SELECT l.status, p.owner_id
  INTO v_status, v_owner
  FROM public.leases l
  JOIN public.properties p ON p.id = l.property_id
  WHERE l.id = p_lease_id
  FOR UPDATE OF l;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Lease not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('terminated', 'expired') THEN
    RAISE EXCEPTION 'Lease is already ended' USING ERRCODE = '22023';
  END IF;

  v_is_staff := (SELECT private.is_admin_or_finance());
  v_is_owner := (
    (SELECT private.is_landlord())
    AND v_owner IS NOT NULL
    AND v_owner = v_actor
  );

  IF NOT (v_is_staff OR v_is_owner) THEN
    RAISE EXCEPTION 'Not allowed to terminate this lease' USING ERRCODE = '42501';
  END IF;

  IF p_outcome IS NOT NULL THEN
    PERFORM public.settle_lease_deposit(p_lease_id, p_outcome, p_notes);
  END IF;

  UPDATE public.leases
  SET status = 'terminated'
  WHERE id = p_lease_id;

  RETURN p_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.terminate_lease_with_deposit(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_lease_with_deposit(UUID, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 9. Restrict purchase-documents storage SELECT
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can read purchase documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Purchase parties can read purchase documents storage" ON storage.objects;
CREATE POLICY "Purchase parties can read purchase documents storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR EXISTS (
        SELECT 1
        FROM public.property_purchases pp
        WHERE pp.id::text = (storage.foldername(name))[1]
          AND pp.buyer_id = (auth.jwt()->>'sub')
      )
      OR (
        (SELECT private.is_landlord())
        AND EXISTS (
          SELECT 1
          FROM public.property_purchases pp
          JOIN public.properties p ON p.id = pp.property_id
          WHERE pp.id::text = (storage.foldername(name))[1]
            AND p.owner_id = (auth.jwt()->>'sub')
        )
      )
    )
  );
