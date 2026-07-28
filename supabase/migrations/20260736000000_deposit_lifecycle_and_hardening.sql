-- Deposit lifecycle: terminal statuses, release reserved listings, settle payment rows,
-- private purchase-documents, and tighten staff UPDATE so status changes go through RPCs.

-- -------------------------------------------------------
-- 1. Terminal deposit statuses (released / settled)
-- -------------------------------------------------------
ALTER TABLE public.deposit_payments
  DROP CONSTRAINT IF EXISTS deposit_payments_status_check;

ALTER TABLE public.deposit_payments
  ADD CONSTRAINT deposit_payments_status_check
  CHECK (status IN ('pending', 'verified', 'failed', 'released', 'settled'));

-- Keep at most one active verified hold per property (terminal rows no longer block re-rent).
DROP INDEX IF EXISTS public.deposit_payments_verified_property_uidx;
CREATE UNIQUE INDEX deposit_payments_verified_property_uidx
  ON public.deposit_payments (property_id)
  WHERE status = 'verified';

-- -------------------------------------------------------
-- 2. Settle linked deposit_payments when lease deposit is settled
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

  -- Free the verified unique slot so the property can accept a future booking deposit.
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

-- -------------------------------------------------------
-- 3. On lease end, settle any leftover linked verified deposits
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
      status = 'settled',
      notes = COALESCE(notes, 'Settled on lease end')
    WHERE lease_id = NEW.id
      AND status = 'verified';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_deposit_payment_on_lease_end ON public.leases;
CREATE TRIGGER trg_settle_deposit_payment_on_lease_end
  AFTER UPDATE OF status ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_deposit_payment_on_lease_end();

REVOKE ALL ON FUNCTION public.settle_deposit_payment_on_lease_end() FROM PUBLIC;

-- -------------------------------------------------------
-- 4. Release a verified, unlinked deposit (unreserve listing)
-- -------------------------------------------------------
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

  -- Restore availability when nothing else holds the listing.
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
  WHERE p.id = v_property_id
    AND p.type = 'rental';

  RETURN p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_deposit_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_deposit_payment(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 5. Staff must use RPCs for purchase/deposit status changes
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Staff can update deposit payments" ON public.deposit_payments;
DROP POLICY IF EXISTS "Staff can update purchases" ON public.property_purchases;

-- -------------------------------------------------------
-- 6. Private purchase-documents bucket
-- -------------------------------------------------------
UPDATE storage.buckets
SET public = false
WHERE id = 'purchase-documents';

-- Authenticated read already exists; ensure buyer/staff/landlord can still SELECT objects.
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
