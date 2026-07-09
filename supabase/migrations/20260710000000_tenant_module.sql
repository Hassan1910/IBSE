-- =======================================================
-- IBSA Homes — Tenant Module extension
-- Adds tenant profile fields, notifications, maintenance
-- confirmation, and storage policies for tenant uploads.
-- Run this AFTER supabase_schema.sql and landlord migration.
-- =======================================================

-- -------------------------------------------------------
-- 1. Tenant profile fields
-- -------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS id_number TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- -------------------------------------------------------
-- 2. Notifications table
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'rent_due',
      'payment_confirmed',
      'maintenance_update',
      'lease_expiry',
      'announcement',
      'feedback_reply'
    )
  ),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_read_at_idx ON public.notifications (read_at);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON public.notifications (created_at DESC);

-- Tenants and all users can read their own notifications.
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (auth.jwt()->>'sub'));

-- Users can mark their own notifications as read.
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (auth.jwt()->>'sub'))
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

-- Admin/finance and landlords can send notifications.
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

-- -------------------------------------------------------
-- 3. Maintenance tenant confirmation
-- -------------------------------------------------------
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS tenant_confirmed_at TIMESTAMP WITH TIME ZONE;

DROP POLICY IF EXISTS "Tenants can confirm resolved requests" ON public.maintenance_requests;
CREATE POLICY "Tenants can confirm resolved requests" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt()->>'sub') AND status = 'resolved')
  WITH CHECK (tenant_id = (auth.jwt()->>'sub'));

-- -------------------------------------------------------
-- 4. Storage buckets and policies
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('maintenance-images', 'maintenance-images', true)
ON CONFLICT (id) DO NOTHING;

-- Avatars bucket policies (path prefix must match user id)
DROP POLICY IF EXISTS "Users can read own avatars" ON storage.objects;
CREATE POLICY "Users can read own avatars" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can upload own avatars" ON storage.objects;
CREATE POLICY "Users can upload own avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
CREATE POLICY "Users can update own avatars" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
CREATE POLICY "Users can delete own avatars" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

-- Maintenance images bucket policies (path prefix must match user id)
DROP POLICY IF EXISTS "Users can read own maintenance images" ON storage.objects;
CREATE POLICY "Users can read own maintenance images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can upload own maintenance images" ON storage.objects;
CREATE POLICY "Users can upload own maintenance images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can update own maintenance images" ON storage.objects;
CREATE POLICY "Users can update own maintenance images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  )
  WITH CHECK (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Users can delete own maintenance images" ON storage.objects;
CREATE POLICY "Users can delete own maintenance images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );
