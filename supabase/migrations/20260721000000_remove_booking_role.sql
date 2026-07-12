-- =======================================================
-- Remove the dedicated 'booking' staff role.
-- Admins already manage viewing/reservation requests from
-- the admin dashboard; booking-officer accounts are folded
-- into admin.
-- =======================================================

-- 1. Migrate existing booking users → admin before tightening CHECKs
UPDATE public.profiles
SET role = 'admin'
WHERE role = 'booking';

-- Pending invites for booking → admin (so they remain usable)
UPDATE public.user_invites
SET role = 'admin'
WHERE role = 'booking'
  AND status = 'pending';

-- 2. Tighten role CHECKs (no 'booking')
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'finance', 'tenant', 'client', 'landlord'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_invites'
  ) THEN
    ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_role_check;
    ALTER TABLE public.user_invites
      ADD CONSTRAINT user_invites_role_check
      CHECK (role IN ('admin', 'finance', 'tenant', 'client', 'landlord'));
  END IF;
END $$;

-- 3. Bookings RLS: admins only (was admin + booking)
DROP POLICY IF EXISTS "Booking officers and Admins can view all bookings" ON public.bookings;
CREATE POLICY "Admins can view all bookings" ON public.bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Booking officers and Admins can update bookings" ON public.bookings;
CREATE POLICY "Admins can update bookings" ON public.bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );

-- 4. Maintenance staff policies: drop booking from staff set
DROP POLICY IF EXISTS "Admins and Staff can view all requests" ON public.maintenance_requests;
CREATE POLICY "Admins and Staff can view all requests" ON public.maintenance_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

DROP POLICY IF EXISTS "Admins and Staff can update requests" ON public.maintenance_requests;
CREATE POLICY "Admins and Staff can update requests" ON public.maintenance_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

-- 5. Inventory SELECT: drop booking from staff set
DROP POLICY IF EXISTS "Admins and Staff can view inventory" ON public.inventory;
CREATE POLICY "Admins and Staff can view inventory" ON public.inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

-- 6. Notifications: staff creators no longer include booking
DROP POLICY IF EXISTS "Staff can create notifications" ON public.notifications;
CREATE POLICY "Staff can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (auth.jwt()->>'sub')
        AND p.role IN ('admin', 'finance', 'landlord')
    )
  );

-- 7. notify_for_property: allowed roles without booking
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
    WHERE role = 'admin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_for_property(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_for_property(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
