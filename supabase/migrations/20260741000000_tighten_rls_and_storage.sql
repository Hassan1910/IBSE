-- Tighten RLS and storage policies
--
-- 1. Properties: anonymous visitors only see listed ('available') rows;
--    signed-in users see available rows plus rows they own or are a party to.
-- 2. Profiles: landlords only see tenant/client profiles linked to their own
--    properties (lease, unit, booking, deposit, purchase, maintenance, payment).
-- 3. Profiles: landlords may only promote a client -> tenant when that client is
--    linked to them, and may not edit any other profile field.
-- 4. Landlords get an exact-email lookup RPC so "Assign lease" still works for a
--    brand-new client (replaces browsing every client in the system).
-- 5. Notifications: landlords may only notify themselves or linked tenants/clients.
-- 6. Storage: contracts, lease-documents, payment-proofs, payment-receipts and
--    maintenance-images become private; reads limited to the owner and the
--    parties of the related lease/payment/property; contract and lease-document
--    writes limited to the owning landlord (or admin).
--    property-images and avatars stay public on purpose (shown on the public
--    listing page and next to names).
--
-- Auth model unchanged: Clerk JWT, caller id = auth.jwt()->>'sub'.

-- -------------------------------------------------------
-- 0. Helpers (SECURITY DEFINER so policies don't recurse through RLS)
-- -------------------------------------------------------

-- Is the caller a party to this property (tenant, client, buyer, requester)?
CREATE OR REPLACE FUNCTION private.is_property_party(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.leases l
            WHERE l.property_id = p_property_id AND l.tenant_id = (auth.jwt()->>'sub'))
    OR EXISTS (SELECT 1 FROM public.units u
            WHERE u.property_id = p_property_id AND u.tenant_id = (auth.jwt()->>'sub'))
    OR EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.property_id = p_property_id AND b.client_id = (auth.jwt()->>'sub'))
    OR EXISTS (SELECT 1 FROM public.deposit_payments d
            WHERE d.property_id = p_property_id AND d.client_id = (auth.jwt()->>'sub'))
    OR EXISTS (SELECT 1 FROM public.property_purchases pp
            WHERE pp.property_id = p_property_id AND pp.buyer_id = (auth.jwt()->>'sub'))
    OR EXISTS (SELECT 1 FROM public.maintenance_requests mr
            WHERE mr.property_id = p_property_id AND mr.tenant_id = (auth.jwt()->>'sub'));
$$;

REVOKE EXECUTE ON FUNCTION private.is_property_party(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_property_party(uuid) TO authenticated;

-- Is p_user_id linked to the calling landlord through one of the landlord's
-- properties or leases?
CREATE OR REPLACE FUNCTION private.landlord_linked_to_user(p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND (auth.jwt()->>'sub') IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.leases l
              LEFT JOIN public.properties p ON p.id = l.property_id
              WHERE l.tenant_id = p_user_id
                AND (p.owner_id = (auth.jwt()->>'sub') OR l.owner_id = (auth.jwt()->>'sub')))
      OR EXISTS (SELECT 1 FROM public.units u
              LEFT JOIN public.properties p ON p.id = u.property_id
              WHERE u.tenant_id = p_user_id
                AND (p.owner_id = (auth.jwt()->>'sub') OR u.owner_id = (auth.jwt()->>'sub')))
      OR EXISTS (SELECT 1 FROM public.bookings b
              JOIN public.properties p ON p.id = b.property_id
              WHERE b.client_id = p_user_id AND p.owner_id = (auth.jwt()->>'sub'))
      OR EXISTS (SELECT 1 FROM public.deposit_payments d
              JOIN public.properties p ON p.id = d.property_id
              WHERE d.client_id = p_user_id AND p.owner_id = (auth.jwt()->>'sub'))
      OR EXISTS (SELECT 1 FROM public.property_purchases pp
              JOIN public.properties p ON p.id = pp.property_id
              WHERE pp.buyer_id = p_user_id AND p.owner_id = (auth.jwt()->>'sub'))
      OR EXISTS (SELECT 1 FROM public.maintenance_requests mr
              JOIN public.properties p ON p.id = mr.property_id
              WHERE mr.tenant_id = p_user_id AND p.owner_id = (auth.jwt()->>'sub'))
      OR EXISTS (SELECT 1 FROM public.payments pay
              JOIN public.leases l ON l.id = pay.lease_id
              LEFT JOIN public.properties p ON p.id = l.property_id
              WHERE pay.payer_id = p_user_id
                AND (p.owner_id = (auth.jwt()->>'sub') OR l.owner_id = (auth.jwt()->>'sub')))
    );
$$;

REVOKE EXECUTE ON FUNCTION private.landlord_linked_to_user(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.landlord_linked_to_user(text) TO authenticated;

-- Does a stored URL (public/signed URL or bare path) point at bucket/name?
CREATE OR REPLACE FUNCTION private.storage_url_matches(p_url text, p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_url IS NOT NULL AND p_name IS NOT NULL AND (
    split_part(p_url, '?', 1) = p_name
    OR right(split_part(p_url, '?', 1), length(p_bucket) + length(p_name) + 2)
       = '/' || p_bucket || '/' || p_name
  );
$$;

REVOKE EXECUTE ON FUNCTION private.storage_url_matches(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.storage_url_matches(text, text, text) TO authenticated;

-- Can the caller read this object in one of the now-private buckets?
CREATE OR REPLACE FUNCTION private.can_read_storage_object(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT (auth.jwt()->>'sub') AS sub),
  path AS (
    SELECT split_part(p_name, '/', 1) AS f1, split_part(p_name, '/', 2) AS f2
  )
  SELECT
    (SELECT sub FROM me) IS NOT NULL
    AND (
      -- Staff see everything
      (SELECT private.is_admin_or_finance())
      -- Uploader / folder owner
      OR (SELECT f1 FROM path) = (SELECT sub FROM me)
      OR CASE p_bucket
        WHEN 'contracts' THEN
          EXISTS (SELECT 1 FROM public.leases l
                  LEFT JOIN public.properties p ON p.id = l.property_id
                  WHERE private.storage_url_matches(l.contract_url, p_bucket, p_name)
                    AND (l.tenant_id = (SELECT sub FROM me)
                         OR l.owner_id = (SELECT sub FROM me)
                         OR p.owner_id = (SELECT sub FROM me)))
          OR EXISTS (SELECT 1 FROM public.lease_documents ld
                  JOIN public.leases l ON l.id = ld.lease_id
                  LEFT JOIN public.properties p ON p.id = l.property_id
                  WHERE private.storage_url_matches(ld.file_url, p_bucket, p_name)
                    AND (l.tenant_id = (SELECT sub FROM me)
                         OR l.owner_id = (SELECT sub FROM me)
                         OR p.owner_id = (SELECT sub FROM me)))
        WHEN 'lease-documents' THEN
          -- path: {landlordId}/{leaseId}/{file}
          EXISTS (SELECT 1 FROM public.leases l
                  LEFT JOIN public.properties p ON p.id = l.property_id
                  WHERE l.id::text = (SELECT f2 FROM path)
                    AND (l.tenant_id = (SELECT sub FROM me)
                         OR l.owner_id = (SELECT sub FROM me)
                         OR p.owner_id = (SELECT sub FROM me)))
        WHEN 'payment-receipts' THEN
          -- path: {paymentId}/{file}
          EXISTS (SELECT 1 FROM public.payments pay
                  LEFT JOIN public.leases l ON l.id = pay.lease_id
                  LEFT JOIN public.properties p ON p.id = l.property_id
                  WHERE pay.id::text = (SELECT f1 FROM path)
                    AND (pay.payer_id = (SELECT sub FROM me)
                         OR l.tenant_id = (SELECT sub FROM me)
                         OR l.owner_id = (SELECT sub FROM me)
                         OR p.owner_id = (SELECT sub FROM me)))
        WHEN 'payment-proofs' THEN
          -- path: {payerId}/{file}; landlords see proofs attached to their own records
          EXISTS (SELECT 1 FROM public.payments pay
                  JOIN public.leases l ON l.id = pay.lease_id
                  LEFT JOIN public.properties p ON p.id = l.property_id
                  WHERE private.storage_url_matches(pay.proof_url, p_bucket, p_name)
                    AND (l.owner_id = (SELECT sub FROM me) OR p.owner_id = (SELECT sub FROM me)))
          OR EXISTS (SELECT 1 FROM public.deposit_payments d
                  JOIN public.properties p ON p.id = d.property_id
                  WHERE private.storage_url_matches(d.proof_url, p_bucket, p_name)
                    AND p.owner_id = (SELECT sub FROM me))
          OR EXISTS (SELECT 1 FROM public.property_purchases pp
                  JOIN public.properties p ON p.id = pp.property_id
                  WHERE private.storage_url_matches(pp.proof_url, p_bucket, p_name)
                    AND p.owner_id = (SELECT sub FROM me))
        WHEN 'maintenance-images' THEN
          -- path: {tenantId}/{requestId}/{file}
          EXISTS (SELECT 1 FROM public.maintenance_requests mr
                  LEFT JOIN public.properties p ON p.id = mr.property_id
                  WHERE mr.id::text = (SELECT f2 FROM path)
                    AND (mr.tenant_id = (SELECT sub FROM me)
                         OR mr.assigned_to = (SELECT sub FROM me)
                         OR p.owner_id = (SELECT sub FROM me)))
        ELSE false
      END
    );
$$;

REVOKE EXECUTE ON FUNCTION private.can_read_storage_object(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_storage_object(text, text) TO authenticated;

-- Does the calling landlord own lease p_lease_id (as text, from a storage path)?
CREATE OR REPLACE FUNCTION private.owns_lease(p_lease_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leases l
    LEFT JOIN public.properties p ON p.id = l.property_id
    WHERE l.id::text = p_lease_id
      AND (l.owner_id = (auth.jwt()->>'sub') OR p.owner_id = (auth.jwt()->>'sub'))
  );
$$;

REVOKE EXECUTE ON FUNCTION private.owns_lease(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owns_lease(text) TO authenticated;

-- Does the calling landlord own the lease behind payment p_payment_id?
CREATE OR REPLACE FUNCTION private.owns_payment(p_payment_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    LEFT JOIN public.properties p ON p.id = l.property_id
    WHERE pay.id::text = p_payment_id
      AND (l.owner_id = (auth.jwt()->>'sub') OR p.owner_id = (auth.jwt()->>'sub'))
  );
$$;

REVOKE EXECUTE ON FUNCTION private.owns_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owns_payment(text) TO authenticated;

-- -------------------------------------------------------
-- 1. Properties: no more "everyone sees every row"
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view properties" ON public.properties;
DROP POLICY IF EXISTS "Public can view available properties" ON public.properties;
DROP POLICY IF EXISTS "Owners staff and parties can view properties" ON public.properties;

-- The public landing page (PropertyBrowseList) lists status = 'available' only.
CREATE POLICY "Public can view available properties" ON public.properties
  FOR SELECT TO anon, authenticated
  USING (status = 'available');

CREATE POLICY "Owners staff and parties can view properties" ON public.properties
  FOR SELECT TO authenticated
  USING (
    owner_id = (auth.jwt()->>'sub')
    OR (SELECT private.is_admin_or_finance())
    OR private.is_property_party(id)
  );

-- -------------------------------------------------------
-- 2. Profiles: landlords only see linked tenants / clients
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Landlords can view tenant and client profiles" ON public.profiles;
DROP POLICY IF EXISTS "Landlords can view linked tenant and client profiles" ON public.profiles;
CREATE POLICY "Landlords can view linked tenant and client profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    role IN ('tenant', 'client')
    AND (SELECT private.is_landlord())
    AND private.landlord_linked_to_user(id)
  );

-- -------------------------------------------------------
-- 3. Profiles: promotion only for linked clients, role column only
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Landlords can promote clients to tenants" ON public.profiles;
CREATE POLICY "Landlords can promote clients to tenants" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    role = 'client'
    AND (SELECT private.is_landlord())
    AND private.landlord_linked_to_user(id)
  )
  WITH CHECK (
    role = 'tenant'
    AND (SELECT private.is_landlord())
    AND private.landlord_linked_to_user(id)
  );

-- When someone other than the profile owner / an admin updates a profile
-- (i.e. a landlord promoting a client), only the role may change.
CREATE OR REPLACE FUNCTION private.restrict_foreign_profile_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sub TEXT := auth.jwt()->>'sub';
BEGIN
  IF current_setting('app.bypass_account_status', true) = 'on'
     OR COALESCE(auth.jwt()->>'role', '') = 'service_role'
     OR v_sub IS NULL
     OR v_sub = OLD.id
     OR private.is_admin() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'role') IS DISTINCT FROM (to_jsonb(OLD) - 'role') THEN
    RAISE EXCEPTION 'Only the role can be changed on another user''s profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.restrict_foreign_profile_edits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_restrict_foreign_profile_edits ON public.profiles;
CREATE TRIGGER trg_restrict_foreign_profile_edits
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.restrict_foreign_profile_edits();

-- -------------------------------------------------------
-- 4. Lease assignment lookup (exact email, landlord/staff only)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_lease_candidate_by_email(p_email text)
RETURNS TABLE (id text, full_name text, email text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT ((SELECT private.is_landlord()) OR (SELECT private.is_admin_or_finance())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.full_name, pr.email, pr.role
  FROM public.profiles pr
  WHERE lower(pr.email) = lower(btrim(p_email))
    AND pr.role IN ('client', 'tenant')
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_lease_candidate_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_lease_candidate_by_email(text) TO authenticated;

-- -------------------------------------------------------
-- 5. Notifications: landlords only notify self or linked people
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Staff can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins and Finance can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Landlords can notify themselves and linked users" ON public.notifications;

CREATE POLICY "Admins and Finance can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin_or_finance()));

CREATE POLICY "Landlords can notify themselves and linked users" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_landlord())
    AND (
      user_id = (auth.jwt()->>'sub')
      OR private.landlord_linked_to_user(user_id)
    )
  );

-- -------------------------------------------------------
-- 6. Storage
-- -------------------------------------------------------
-- 6a. Sensitive buckets become private (public URLs stop working; the app
--     now opens them through short-lived signed URLs).
--     Kept public on purpose: property-images (public listings) and avatars.
UPDATE storage.buckets
SET public = false
WHERE id IN ('contracts', 'lease-documents', 'payment-proofs', 'payment-receipts', 'maintenance-images');

-- 6b. Reads
DROP POLICY IF EXISTS "Authenticated users can read contracts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read lease documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read payment receipts" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read maintenance images" ON storage.objects;
DROP POLICY IF EXISTS "Parties can read private documents" ON storage.objects;

CREATE POLICY "Parties can read private documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('contracts', 'lease-documents', 'payment-proofs', 'payment-receipts', 'maintenance-images')
    AND private.can_read_storage_object(bucket_id, name)
  );

-- 6c. Contracts: admin, or a landlord writing into their own folder
DROP POLICY IF EXISTS "Staff can upload contracts" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update contracts" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete contracts" ON storage.objects;

CREATE POLICY "Staff can upload contracts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR ((SELECT private.is_landlord()) AND split_part(name, '/', 1) = (auth.jwt()->>'sub'))
    )
  );

CREATE POLICY "Staff can update contracts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR ((SELECT private.is_landlord()) AND split_part(name, '/', 1) = (auth.jwt()->>'sub'))
    )
  )
  WITH CHECK (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR ((SELECT private.is_landlord()) AND split_part(name, '/', 1) = (auth.jwt()->>'sub'))
    )
  );

CREATE POLICY "Staff can delete contracts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR ((SELECT private.is_landlord()) AND split_part(name, '/', 1) = (auth.jwt()->>'sub'))
    )
  );

-- 6d. Lease documents: admin/finance, or the landlord who owns the lease,
--     writing under {theirId}/{leaseId}/...
DROP POLICY IF EXISTS "Staff can upload lease documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update lease documents storage" ON storage.objects;

CREATE POLICY "Staff can upload lease documents storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (
        (SELECT private.is_landlord())
        AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
        AND private.owns_lease(split_part(name, '/', 2))
      )
    )
  );

CREATE POLICY "Staff can update lease documents storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (
        (SELECT private.is_landlord())
        AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
        AND private.owns_lease(split_part(name, '/', 2))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (
        (SELECT private.is_landlord())
        AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
        AND private.owns_lease(split_part(name, '/', 2))
      )
    )
  );

-- 6e. Payment receipts: admin/finance, or the landlord who owns the payment's lease
DROP POLICY IF EXISTS "Staff can upload payment receipts" ON storage.objects;

CREATE POLICY "Staff can upload payment receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (
        (SELECT private.is_landlord())
        AND private.owns_payment(split_part(name, '/', 1))
      )
    )
  );
