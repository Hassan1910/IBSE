-- =======================================================
-- IBSA Homes — Systematic Flow completion
-- 1. Booking lifecycle: adds 'completed' and 'cancelled'
--    statuses so booking officers can track viewings
--    end-to-end (schedule, update, complete, cancel).
-- 2. Inventory usage: links maintenance work to inventory
--    stock so materials used on repairs decrement stock.
-- 3. Notifications: adds a 'booking_update' type and lets
--    booking officers send notifications to clients.
-- Run this AFTER the admin, landlord and tenant migrations.
-- =======================================================

-- -------------------------------------------------------
-- 0. Prerequisite helper functions (defensive re-creation)
--    These are normally created by supabase_schema.sql and
--    the admin/landlord migrations. CREATE OR REPLACE is
--    idempotent, so re-defining them here is harmless and
--    guarantees this migration never fails on a missing
--    helper.
-- -------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT (auth.jwt()->>'sub')) AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_admin_or_finance()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT (auth.jwt()->>'sub')) AND role IN ('admin', 'finance')
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_admin_or_finance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin_or_finance() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_landlord()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT (auth.jwt()->>'sub')) AND role = 'landlord'
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_landlord() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_landlord() TO authenticated;

-- -------------------------------------------------------
-- 1. Booking lifecycle statuses
-- -------------------------------------------------------
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'completed', 'cancelled'));

-- -------------------------------------------------------
-- 2. Inventory usage (maintenance materials tracking)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_usages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE CASCADE NOT NULL,
  maintenance_request_id UUID REFERENCES public.maintenance_requests(id) ON DELETE SET NULL,
  quantity_used INTEGER NOT NULL CHECK (quantity_used > 0),
  used_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.inventory_usages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS inventory_usages_inventory_id_idx
  ON public.inventory_usages (inventory_id);
CREATE INDEX IF NOT EXISTS inventory_usages_maintenance_request_id_idx
  ON public.inventory_usages (maintenance_request_id);
CREATE INDEX IF NOT EXISTS inventory_usages_created_at_idx
  ON public.inventory_usages (created_at DESC);

-- Admins and finance can view all usage history.
DROP POLICY IF EXISTS "Admins and Finance can view inventory usage" ON public.inventory_usages;
CREATE POLICY "Admins and Finance can view inventory usage" ON public.inventory_usages
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

-- Admins can manage all usage records.
DROP POLICY IF EXISTS "Admins can manage inventory usage" ON public.inventory_usages;
CREATE POLICY "Admins can manage inventory usage" ON public.inventory_usages
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- Landlords may record and view materials they used on
-- maintenance requests for their own properties.
DROP POLICY IF EXISTS "Landlords can record their own inventory usage" ON public.inventory_usages;
CREATE POLICY "Landlords can record their own inventory usage" ON public.inventory_usages
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_landlord())
    AND used_by = (auth.jwt()->>'sub')
    AND EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE mr.id = inventory_usages.maintenance_request_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can view their own inventory usage" ON public.inventory_usages;
CREATE POLICY "Landlords can view their own inventory usage" ON public.inventory_usages
  FOR SELECT TO authenticated
  USING (used_by = (auth.jwt()->>'sub'));

-- Landlords need to browse inventory items to pick materials
-- (base schema only grants SELECT to admin/finance/booking).
DROP POLICY IF EXISTS "Landlords can view inventory" ON public.inventory;
CREATE POLICY "Landlords can view inventory" ON public.inventory
  FOR SELECT TO authenticated
  USING ((SELECT private.is_landlord()));

-- Decrement stock automatically whenever usage is recorded.
-- SECURITY DEFINER so landlords (who cannot UPDATE inventory
-- directly) still trigger the stock adjustment.
CREATE OR REPLACE FUNCTION private.apply_inventory_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_qty INTEGER;
BEGIN
  UPDATE public.inventory
  SET quantity = GREATEST(0, quantity - NEW.quantity_used),
      updated_at = timezone('utc'::text, now())
  WHERE id = NEW.inventory_id
  RETURNING quantity INTO new_qty;

  IF new_qty IS NOT NULL THEN
    UPDATE public.inventory
    SET status = CASE
      WHEN new_qty = 0 THEN 'out_of_stock'
      WHEN new_qty < 5 THEN 'low_stock'
      ELSE 'in_stock'
    END
    WHERE id = NEW.inventory_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_usages_apply_stock ON public.inventory_usages;
CREATE TRIGGER inventory_usages_apply_stock
  AFTER INSERT ON public.inventory_usages
  FOR EACH ROW EXECUTE FUNCTION private.apply_inventory_usage();

-- -------------------------------------------------------
-- 3. Booking notifications
-- -------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'rent_due',
      'payment_confirmed',
      'maintenance_update',
      'lease_expiry',
      'announcement',
      'feedback_reply',
      'booking_update'
    )
  );

-- Booking officers also need to notify clients about
-- reschedules, cancellations and completions.
DROP POLICY IF EXISTS "Staff can create notifications" ON public.notifications;
CREATE POLICY "Staff can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (auth.jwt()->>'sub')
        AND p.role IN ('admin', 'finance', 'landlord', 'booking')
    )
  );
