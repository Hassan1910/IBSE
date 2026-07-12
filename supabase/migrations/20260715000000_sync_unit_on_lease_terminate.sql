-- =======================================================
-- Keep unit occupancy + property rented status in sync
-- with active leases (fixes stale vacant/occupied after
-- terminate, and heals already-out-of-date rows).
-- =======================================================

-- Free units that have no active lease pointing at them
UPDATE public.units AS u
SET
  status = 'vacant',
  tenant_id = NULL
WHERE u.status = 'occupied'
  AND NOT EXISTS (
    SELECT 1
    FROM public.leases AS l
    WHERE l.unit_id = u.id
      AND l.status = 'active'
  );

-- Occupy units that still have an active lease
UPDATE public.units AS u
SET
  status = 'occupied',
  tenant_id = l.tenant_id
FROM public.leases AS l
WHERE l.unit_id = u.id
  AND l.status = 'active';

-- Mark rental properties available when they have no active lease
UPDATE public.properties AS p
SET status = 'available'
WHERE p.type = 'rental'
  AND p.status = 'rented'
  AND NOT EXISTS (
    SELECT 1
    FROM public.leases AS l
    WHERE l.property_id = p.id
      AND l.status = 'active'
  );

-- Mark rental properties rented when they have an active lease
UPDATE public.properties AS p
SET status = 'rented'
WHERE p.type = 'rental'
  AND p.status IS DISTINCT FROM 'rented'
  AND EXISTS (
    SELECT 1
    FROM public.leases AS l
    WHERE l.property_id = p.id
      AND l.status = 'active'
  );

-- -------------------------------------------------------
-- Trigger: lease changes drive unit + property status
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

DROP TRIGGER IF EXISTS trg_leases_sync_occupancy ON public.leases;
CREATE TRIGGER trg_leases_sync_occupancy
  AFTER INSERT OR UPDATE OF status, unit_id, tenant_id, property_id OR DELETE
  ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_occupancy_from_lease();

REVOKE EXECUTE ON FUNCTION private.sync_occupancy_from_lease() FROM PUBLIC, anon, authenticated;
