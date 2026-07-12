-- =======================================================
-- Pending leases (activate on verified payment) +
-- prevent overlapping pending/active leases on the same
-- unit or whole-property rental.
-- =======================================================

-- -------------------------------------------------------
-- 1. Allow status = pending; default new leases to pending
-- -------------------------------------------------------
ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_status_check;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_status_check
  CHECK (status IN ('pending', 'active', 'terminated', 'expired'));

ALTER TABLE public.leases
  ALTER COLUMN status SET DEFAULT 'pending';

-- -------------------------------------------------------
-- 2. Clean up duplicate overlapping active leases
--    Keep the longer (then newer) lease; terminate losers.
-- -------------------------------------------------------
WITH unit_overlap AS (
  SELECT DISTINCT a.id AS loser_id
  FROM public.leases AS a
  JOIN public.leases AS b
    ON a.unit_id = b.unit_id
   AND a.id <> b.id
   AND a.status = 'active'
   AND b.status = 'active'
   AND a.unit_id IS NOT NULL
   AND a.start_date <= b.end_date
   AND b.start_date <= a.end_date
   AND (
     a.end_date < b.end_date
     OR (a.end_date = b.end_date AND COALESCE(a.created_at, '-infinity'::timestamptz) < COALESCE(b.created_at, '-infinity'::timestamptz))
     OR (
       a.end_date = b.end_date
       AND a.created_at IS NOT DISTINCT FROM b.created_at
       AND a.id < b.id
     )
   )
),
property_overlap AS (
  SELECT DISTINCT a.id AS loser_id
  FROM public.leases AS a
  JOIN public.leases AS b
    ON a.property_id = b.property_id
   AND a.id <> b.id
   AND a.status = 'active'
   AND b.status = 'active'
   AND a.unit_id IS NULL
   AND b.unit_id IS NULL
   AND a.start_date <= b.end_date
   AND b.start_date <= a.end_date
   AND (
     a.end_date < b.end_date
     OR (a.end_date = b.end_date AND COALESCE(a.created_at, '-infinity'::timestamptz) < COALESCE(b.created_at, '-infinity'::timestamptz))
     OR (
       a.end_date = b.end_date
       AND a.created_at IS NOT DISTINCT FROM b.created_at
       AND a.id < b.id
     )
   )
)
UPDATE public.leases
SET status = 'terminated'
WHERE id IN (
  SELECT loser_id FROM unit_overlap
  UNION
  SELECT loser_id FROM property_overlap
);

-- -------------------------------------------------------
-- 3. Overlap guard (pending + active)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prevent_overlapping_leases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' AND NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Lease end date must be on or after start date'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.unit_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.leases AS l
      WHERE l.unit_id = NEW.unit_id
        AND l.id IS DISTINCT FROM NEW.id
        AND l.status IN ('pending', 'active')
        AND l.start_date <= NEW.end_date
        AND NEW.start_date <= l.end_date
    ) THEN
      RAISE EXCEPTION 'This unit already has an overlapping pending or active lease'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.leases AS l
      WHERE l.property_id = NEW.property_id
        AND l.unit_id IS NULL
        AND l.id IS DISTINCT FROM NEW.id
        AND l.status IN ('pending', 'active')
        AND l.start_date <= NEW.end_date
        AND NEW.start_date <= l.end_date
    ) THEN
      RAISE EXCEPTION 'This property already has an overlapping pending or active lease'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leases_prevent_overlap ON public.leases;
CREATE TRIGGER trg_leases_prevent_overlap
  BEFORE INSERT OR UPDATE OF unit_id, property_id, start_date, end_date, status
  ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_overlapping_leases();

REVOKE EXECUTE ON FUNCTION private.prevent_overlapping_leases() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------
-- 4. Activate pending lease when payment is verified
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
  THEN
    UPDATE public.leases
    SET status = 'active'
    WHERE id = NEW.lease_id
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_activate_lease ON public.payments;
CREATE TRIGGER trg_payments_activate_lease
  AFTER INSERT OR UPDATE OF status
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION private.activate_lease_on_payment_verified();

REVOKE EXECUTE ON FUNCTION private.activate_lease_on_payment_verified() FROM PUBLIC, anon, authenticated;
