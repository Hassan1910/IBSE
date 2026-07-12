-- =======================================================
-- Tenant portal hardening:
-- 1. Block payers from inserting verified payments
-- 2. Column-safe tenant maintenance UPDATEs
-- 3. Tenants can SELECT units linked via their leases
-- 4. Notify owner or admins (agency properties)
-- 5. payment_submitted notification type
-- =======================================================

-- -------------------------------------------------------
-- 1. Payment INSERT: only staff/landlords may insert verified
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_payment_insert_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  caller_id TEXT := auth.jwt()->>'sub';
  caller_role TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'verified' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = caller_id;

  IF caller_role IN ('admin', 'finance') THEN
    RETURN NEW;
  END IF;

  -- Landlord owning the lease property may insert verified (rare; verify is usually UPDATE)
  IF EXISTS (
    SELECT 1
    FROM public.leases AS l
    JOIN public.properties AS p ON p.id = l.property_id
    WHERE l.id = NEW.lease_id
      AND p.owner_id = caller_id
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only landlords or finance staff can create verified payments'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_insert_status ON public.payments;
CREATE TRIGGER trg_enforce_payment_insert_status
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_insert_status();

-- -------------------------------------------------------
-- 2. Maintenance: tenants may only change image_urls /
--    tenant_confirmed_at (policies stay; trigger enforces columns)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tenant_maintenance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  caller_id TEXT := auth.jwt()->>'sub';
  caller_role TEXT;
BEGIN
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = caller_id;

  IF caller_role IS DISTINCT FROM 'tenant' OR OLD.tenant_id IS DISTINCT FROM caller_id THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.expense_amount IS DISTINCT FROM OLD.expense_amount
     OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Tenants may only update image_urls or tenant_confirmed_at'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.image_urls IS DISTINCT FROM OLD.image_urls
     AND OLD.status NOT IN ('pending', 'in_progress')
  THEN
    RAISE EXCEPTION 'Images can only be attached while the request is pending or in progress'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_confirmed_at IS DISTINCT FROM OLD.tenant_confirmed_at
     AND OLD.status IS DISTINCT FROM 'resolved'
  THEN
    RAISE EXCEPTION 'Tenants can only confirm resolved maintenance requests'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_maintenance_update ON public.maintenance_requests;
CREATE TRIGGER trg_enforce_tenant_maintenance_update
  BEFORE UPDATE ON public.maintenance_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_maintenance_update();

-- -------------------------------------------------------
-- 3. Units: tenants can read units on their leases
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Tenants can view units on their leases" ON public.units;
CREATE POLICY "Tenants can view units on their leases" ON public.units
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT unit_id
      FROM public.leases
      WHERE tenant_id = (auth.jwt()->>'sub')
        AND unit_id IS NOT NULL
    )
  );

-- -------------------------------------------------------
-- 4. Notification type: payment_submitted
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
      'booking_update'
    )
  );

-- -------------------------------------------------------
-- 5. Notify property owner, or admins when owner_id is null
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Tenants can notify admins for agency properties" ON public.notifications;
CREATE POLICY "Tenants can notify admins for agency properties" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = (auth.jwt()->>'sub')
        AND p.role IN ('tenant', 'client')
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS dest
      WHERE dest.id = notifications.user_id
        AND dest.role = 'admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.leases AS l
      JOIN public.properties AS prop ON prop.id = l.property_id
      WHERE l.tenant_id = (auth.jwt()->>'sub')
        AND l.status IN ('pending', 'active')
        AND prop.owner_id IS NULL
    )
  );

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

  IF v_role NOT IN ('admin', 'finance', 'landlord', 'booking', 'tenant', 'client') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- Tenants/clients may only notify for properties on their pending/active lease
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
