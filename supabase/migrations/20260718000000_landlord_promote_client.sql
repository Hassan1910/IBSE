-- =======================================================
-- 1. Allow landlords to promote a client profile to tenant
--    when assigning a lease. Narrow UPDATE: client → tenant only.
-- 2. Allow tenants to notify their property owner (inbound
--    landlord notifications for payments / maintenance).
-- =======================================================

DROP POLICY IF EXISTS "Landlords can promote clients to tenants" ON public.profiles;
CREATE POLICY "Landlords can promote clients to tenants" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_landlord())
    AND role = 'client'
  )
  WITH CHECK (
    (SELECT private.is_landlord())
    AND role = 'tenant'
  );

DROP POLICY IF EXISTS "Tenants can notify their property owner" ON public.notifications;
CREATE POLICY "Tenants can notify their property owner" ON public.notifications
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
      FROM public.leases AS l
      JOIN public.properties AS prop ON prop.id = l.property_id
      WHERE l.tenant_id = (auth.jwt()->>'sub')
        AND l.status IN ('pending', 'active')
        AND prop.owner_id = notifications.user_id
    )
  );
