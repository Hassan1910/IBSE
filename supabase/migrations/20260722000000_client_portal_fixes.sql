-- =======================================================
-- Client portal fixes
-- 1. Clients may cancel their own pending bookings.
-- 2. notify_admins RPC so clients can alert staff after
--    creating a booking or feedback (RLS blocks direct insert).
-- =======================================================

-- -------------------------------------------------------
-- 1. Client cancel pending bookings
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Clients can cancel own pending bookings" ON public.bookings;
CREATE POLICY "Clients can cancel own pending bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    client_id = (auth.jwt()->>'sub')
    AND status = 'pending'
  )
  WITH CHECK (
    client_id = (auth.jwt()->>'sub')
    AND status = 'cancelled'
  );

-- -------------------------------------------------------
-- 2. Notify all admins (SECURITY DEFINER)
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
  WHERE role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
