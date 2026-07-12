-- =======================================================
-- Fix landlord dashboard zeros: keep lease/unit ownership
-- aligned with properties.owner_id, and let landlords read
-- leases/units via property ownership (not only denormalized
-- owner_id). Also sync unit occupancy from active leases.
-- =======================================================

-- -------------------------------------------------------
-- 1. Backfill denormalized owner_id from the parent property
-- -------------------------------------------------------
UPDATE public.leases AS l
SET owner_id = p.owner_id
FROM public.properties AS p
WHERE p.id = l.property_id
  AND p.owner_id IS NOT NULL
  AND (l.owner_id IS NULL OR l.owner_id IS DISTINCT FROM p.owner_id);

UPDATE public.units AS u
SET owner_id = p.owner_id
FROM public.properties AS p
WHERE p.id = u.property_id
  AND p.owner_id IS NOT NULL
  AND (u.owner_id IS NULL OR u.owner_id IS DISTINCT FROM p.owner_id);

-- Sync unit occupancy from active leases that reference a unit
UPDATE public.units AS u
SET
  status = 'occupied',
  tenant_id = l.tenant_id
FROM public.leases AS l
WHERE l.unit_id = u.id
  AND l.status = 'active';

-- -------------------------------------------------------
-- 2. Keep owner_id in sync automatically
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_lease_owner_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT p.owner_id INTO NEW.owner_id
    FROM public.properties AS p
    WHERE p.id = NEW.property_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leases_sync_owner ON public.leases;
CREATE TRIGGER trg_leases_sync_owner
  BEFORE INSERT OR UPDATE OF property_id ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_lease_owner_from_property();

CREATE OR REPLACE FUNCTION private.sync_unit_owner_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT p.owner_id INTO NEW.owner_id
    FROM public.properties AS p
    WHERE p.id = NEW.property_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_units_sync_owner ON public.units;
CREATE TRIGGER trg_units_sync_owner
  BEFORE INSERT OR UPDATE OF property_id ON public.units
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_unit_owner_from_property();

-- When a property's landlord changes, cascade to leases + units
CREATE OR REPLACE FUNCTION private.cascade_property_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    UPDATE public.leases
    SET owner_id = NEW.owner_id
    WHERE property_id = NEW.id;

    UPDATE public.units
    SET owner_id = NEW.owner_id
    WHERE property_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_cascade_owner ON public.properties;
CREATE TRIGGER trg_properties_cascade_owner
  AFTER UPDATE OF owner_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION private.cascade_property_owner_change();

REVOKE EXECUTE ON FUNCTION private.sync_lease_owner_from_property() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.sync_unit_owner_from_property() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.cascade_property_owner_change() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------
-- 3. RLS: landlords can see leases/units on properties they own
--    (covers legacy rows where denormalized owner_id was wrong)
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Landlords can view leases on owned properties" ON public.leases;
CREATE POLICY "Landlords can view leases on owned properties" ON public.leases
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = leases.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can manage leases on owned properties" ON public.leases;
CREATE POLICY "Landlords can manage leases on owned properties" ON public.leases
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = leases.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = leases.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can view units on owned properties" ON public.units;
CREATE POLICY "Landlords can view units on owned properties" ON public.units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = units.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can manage units on owned properties" ON public.units;
CREATE POLICY "Landlords can manage units on owned properties" ON public.units
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = units.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = units.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

-- Payments follow property ownership as well (not only lease.owner_id)
DROP POLICY IF EXISTS "Landlords can view payments on owned properties" ON public.payments;
CREATE POLICY "Landlords can view payments on owned properties" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases
      JOIN public.properties ON properties.id = leases.property_id
      WHERE leases.id = payments.lease_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can verify payments on owned properties" ON public.payments;
CREATE POLICY "Landlords can verify payments on owned properties" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases
      JOIN public.properties ON properties.id = leases.property_id
      WHERE leases.id = payments.lease_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );
