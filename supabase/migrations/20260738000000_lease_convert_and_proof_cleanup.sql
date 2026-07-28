-- Atomic pending-lease creation from booking/deposit context,
-- plus payer DELETE on payment-proofs for orphan cleanup.

-- -------------------------------------------------------
-- 1. create_pending_lease_from_booking
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

  IF p_owner_id IS DISTINCT FROM v_property_owner THEN
    UPDATE public.properties
    SET owner_id = p_owner_id
    WHERE id = p_property_id;
  END IF;

  IF p_deposit_amount > 0 AND p_deposit_id IS NOT NULL THEN
    v_deposit_status := 'held';
  ELSIF p_deposit_amount > 0 THEN
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
    COALESCE(p_deposit_amount, 0),
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

  RETURN v_lease_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_lease_from_booking(
  TEXT, UUID, TEXT, DATE, DATE, NUMERIC, UUID, NUMERIC, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pending_lease_from_booking(
  TEXT, UUID, TEXT, DATE, DATE, NUMERIC, UUID, NUMERIC, UUID, UUID
) TO authenticated;

-- -------------------------------------------------------
-- 2. Payers can delete own payment-proofs (orphan cleanup)
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Payers can delete own payment proofs" ON storage.objects;
CREATE POLICY "Payers can delete own payment proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );
