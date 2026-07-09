-- ============================================================
-- Property Images Storage Bucket
-- ============================================================

-- Create a public bucket for property images
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone (authenticated) to read property images
CREATE POLICY "Anyone can read property images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'property-images');

-- Allow admins and landlords to upload property images
-- Path convention: {userId}/{timestamp}_{filename}
CREATE POLICY "Admins and landlords can upload property images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

CREATE POLICY "Admins and landlords can update property images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  )
  WITH CHECK (
    bucket_id = 'property-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

CREATE POLICY "Admins and landlords can delete property images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );
