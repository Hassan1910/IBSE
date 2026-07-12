-- =======================================================
-- Maintenance images: let tenants attach photos after insert,
-- and let landlords/admins read the public bucket freely.
-- =======================================================

-- Tenants previously could only UPDATE resolved tickets (confirmation).
-- Attaching image_urls after create was silently blocked by RLS.
DROP POLICY IF EXISTS "Tenants can attach images to own requests" ON public.maintenance_requests;
CREATE POLICY "Tenants can attach images to own requests" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (auth.jwt()->>'sub')
    AND status IN ('pending', 'in_progress')
  )
  WITH CHECK (tenant_id = (auth.jwt()->>'sub'));

-- Bucket is public; allow authenticated reads for landlords/admins
-- (owner-only SELECT previously blocked Storage API reads by staff).
DROP POLICY IF EXISTS "Users can read own maintenance images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read maintenance images" ON storage.objects;
CREATE POLICY "Anyone can read maintenance images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'maintenance-images');
