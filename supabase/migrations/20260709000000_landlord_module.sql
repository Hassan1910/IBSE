-- =======================================================
-- IBSA Homes — Landlord Module extension
-- Adds a scoped multi-landlord role. Each landlord owns a
-- subset of the data: properties (owner_id), the units within
-- them, their leases, and — transitively — the payments and
-- maintenance requests tied to those properties/leases.
-- Run this AFTER supabase_schema.sql.
--
-- This migration is idempotent (safe to re-run) and does not
-- require the admin module: the user_invites changes only run
-- if that table already exists.
-- =======================================================

-- -------------------------------------------------------
-- 1. Allow the new 'landlord' role everywhere role is checked
-- -------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'finance', 'booking', 'tenant', 'client', 'landlord'));

-- user_invites is created by the admin module. Only adjust it if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_invites'
  ) THEN
    ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_role_check;
    ALTER TABLE public.user_invites
      ADD CONSTRAINT user_invites_role_check
      CHECK (role IN ('admin', 'finance', 'booking', 'tenant', 'client', 'landlord'));
  END IF;
END $$;

-- -------------------------------------------------------
-- 2. Helper: is the current user a landlord?
--    SECURITY DEFINER bypasses RLS so it can read profiles
--    without triggering the profiles policies recursively.
-- -------------------------------------------------------
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
-- 3. Property ownership
--    Existing seeded rows keep owner_id = NULL (agency-owned).
-- -------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON public.properties (owner_id);

-- Landlords manage only the properties they own. Public SELECT stays
-- (clients browse listings); admins keep their existing full access.
DROP POLICY IF EXISTS "Landlords can insert their own properties" ON public.properties;
CREATE POLICY "Landlords can insert their own properties" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (auth.jwt()->>'sub') AND (SELECT private.is_landlord()));

DROP POLICY IF EXISTS "Landlords can update their own properties" ON public.properties;
CREATE POLICY "Landlords can update their own properties" ON public.properties
  FOR UPDATE TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Landlords can delete their own properties" ON public.properties;
CREATE POLICY "Landlords can delete their own properties" ON public.properties
  FOR DELETE TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'));

-- -------------------------------------------------------
-- 4. Units  (Unit Management)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.units (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  owner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  unit_number TEXT NOT NULL,
  rent_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('occupied', 'vacant')) DEFAULT 'vacant',
  tenant_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS units_property_id_idx ON public.units (property_id);
CREATE INDEX IF NOT EXISTS units_owner_id_idx ON public.units (owner_id);

DROP POLICY IF EXISTS "Landlords can manage their own units" ON public.units;
CREATE POLICY "Landlords can manage their own units" ON public.units
  FOR ALL TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Tenants can view their assigned unit" ON public.units;
CREATE POLICY "Tenants can view their assigned unit" ON public.units
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Admins can manage all units" ON public.units;
CREATE POLICY "Admins can manage all units" ON public.units
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- -------------------------------------------------------
-- 5. Leases  (Rental Agreement Management)
--    owner_id denormalized for fast RLS; unit link + contract + terms.
-- -------------------------------------------------------
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_url TEXT,
  ADD COLUMN IF NOT EXISTS terms TEXT;

CREATE INDEX IF NOT EXISTS leases_owner_id_idx ON public.leases (owner_id);

DROP POLICY IF EXISTS "Landlords can view their own leases" ON public.leases;
CREATE POLICY "Landlords can view their own leases" ON public.leases
  FOR SELECT TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Landlords can manage their own leases" ON public.leases;
CREATE POLICY "Landlords can manage their own leases" ON public.leases
  FOR ALL TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

-- -------------------------------------------------------
-- 6. Payments  (Rent Payment Management)
--    Scoped through the parent lease's owner_id.
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Landlords can view payments on their leases" ON public.payments;
CREATE POLICY "Landlords can view payments on their leases" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases
      WHERE leases.id = payments.lease_id
        AND leases.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can verify payments on their leases" ON public.payments;
CREATE POLICY "Landlords can verify payments on their leases" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases
      WHERE leases.id = payments.lease_id
        AND leases.owner_id = (auth.jwt()->>'sub')
    )
  );

-- -------------------------------------------------------
-- 7. Maintenance Requests  (Maintenance Management)
--    Landlords handle requests on properties they own.
-- -------------------------------------------------------
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;

DROP POLICY IF EXISTS "Landlords can view requests on their properties" ON public.maintenance_requests;
CREATE POLICY "Landlords can view requests on their properties" ON public.maintenance_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = maintenance_requests.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can update requests on their properties" ON public.maintenance_requests;
CREATE POLICY "Landlords can update requests on their properties" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = maintenance_requests.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

-- -------------------------------------------------------
-- 8. Cross-cutting access for landlords
-- -------------------------------------------------------
-- Landlords need to browse tenant/client profiles to assign leases and to
-- read contact details of their tenants (also makes profile joins resolve on
-- payments, leases, and maintenance screens).
DROP POLICY IF EXISTS "Landlords can view tenant and client profiles" ON public.profiles;
CREATE POLICY "Landlords can view tenant and client profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_landlord()) AND role IN ('tenant', 'client'));

-- Landlords may pre-register (invite) tenants by email — only if the
-- user_invites table exists (created by the admin module).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_invites'
  ) THEN
    DROP POLICY IF EXISTS "Landlords can invite tenants" ON public.user_invites;
    CREATE POLICY "Landlords can invite tenants" ON public.user_invites
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT private.is_landlord()) AND role = 'tenant');
  END IF;
END $$;
