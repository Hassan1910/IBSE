-- =======================================================
-- IBSA Homes Property Management System Database Schema
-- =======================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles Table
CREATE TABLE public.profiles (
  id TEXT PRIMARY KEY, -- Maps directly to Clerk user.id (e.g. 'user_...')
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'tenant', 'client')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Private schema + helper function to avoid infinite recursion.
-- SECURITY DEFINER runs as the function owner (postgres) which bypasses RLS,
-- so it can query the profiles table without triggering the same policies again.
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

-- Revoke public access, grant only to authenticated users
REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- Profiles Policies
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING ((SELECT (auth.jwt()->>'sub')) = id);

CREATE POLICY "Users can create their own profile during signup" ON public.profiles
  FOR INSERT WITH CHECK ((SELECT (auth.jwt()->>'sub')) = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING ((SELECT (auth.jwt()->>'sub')) = id) WITH CHECK ((SELECT (auth.jwt()->>'sub')) = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()));


-- 2. Properties Table
CREATE TABLE public.properties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rental', 'sale')),
  category TEXT NOT NULL CHECK (category IN ('residential', 'commercial', 'land')),
  price NUMERIC(12, 2) NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'rented', 'sold')) DEFAULT 'available',
  image_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Properties Policies
CREATE POLICY "Anyone can view properties" ON public.properties
  FOR SELECT USING (true);

CREATE POLICY "Only admins can insert/update/delete properties" ON public.properties
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );


-- 3. Bookings Table
CREATE TABLE public.bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  client_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  booking_date TIMESTAMP WITH TIME ZONE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('viewing', 'reservation')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Bookings Policies
CREATE POLICY "Clients can view their own bookings" ON public.bookings
  FOR SELECT USING (client_id = (auth.jwt()->>'sub'));

CREATE POLICY "Clients can create bookings" ON public.bookings
  FOR INSERT WITH CHECK (client_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins can view all bookings" ON public.bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update bookings" ON public.bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );


-- 4. Leases Table
CREATE TABLE public.leases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  tenant_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  rent_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'terminated', 'expired')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

-- Leases Policies
CREATE POLICY "Tenants can view their own leases" ON public.leases
  FOR SELECT USING (tenant_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins and Finance can view all leases" ON public.leases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

CREATE POLICY "Admins and Finance can modify leases" ON public.leases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );


-- 5. Payments Table
CREATE TABLE public.payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  payer_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  payment_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'cash', 'bank')),
  reference_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Payments Policies
CREATE POLICY "Payers can view their own payments" ON public.payments
  FOR SELECT USING (payer_id = (auth.jwt()->>'sub'));

CREATE POLICY "Payers can submit payments" ON public.payments
  FOR INSERT WITH CHECK (payer_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins and Finance can view all payments" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

CREATE POLICY "Admins and Finance can verify payments" ON public.payments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );


-- 6. Maintenance Requests Table
CREATE TABLE public.maintenance_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
  tenant_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'resolved')) DEFAULT 'pending',
  image_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

-- Maintenance Policies
CREATE POLICY "Tenants can view their own requests" ON public.maintenance_requests
  FOR SELECT USING (tenant_id = (auth.jwt()->>'sub'));

CREATE POLICY "Tenants can create maintenance requests" ON public.maintenance_requests
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins and Staff can view all requests" ON public.maintenance_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

CREATE POLICY "Admins and Staff can update requests" ON public.maintenance_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );


-- 7. Inventory Table
CREATE TABLE public.inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  status TEXT NOT NULL CHECK (status IN ('in_stock', 'low_stock', 'out_of_stock')) DEFAULT 'in_stock',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- Inventory Policies
CREATE POLICY "Admins and Staff can view inventory" ON public.inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance')
    )
  );

CREATE POLICY "Only admins can update inventory" ON public.inventory
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );


-- 8. Feedback Table
CREATE TABLE public.feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('complaint', 'suggestion', 'inquiry')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Feedback Policies
CREATE POLICY "Users can view their own feedback" ON public.feedback
  FOR SELECT USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can create feedback" ON public.feedback
  FOR INSERT WITH CHECK (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins can view all feedback" ON public.feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role = 'admin'
    )
  );

-- =======================================================
-- Seeding Dummy Data for Properties (Optional)
-- =======================================================
INSERT INTO public.properties (title, description, type, category, price, location, status, image_urls)
VALUES
('Modern 3-Bedroom Apartment', 'Spacious apartment near Marsabit Town center, master en-suite, modern finishes.', 'rental', 'residential', 25000.00, 'Marsabit Town', 'available', ARRAY['https://images.unsplash.com/photo-1545324418-cc1a3fa10c00']),
('Commercial Retail Space', 'Prime business location on Gari Road, high foot traffic, 1200 sq ft.', 'rental', 'commercial', 45000.00, 'Marsabit Gari Rd', 'available', ARRAY['https://images.unsplash.com/photo-1486406146926-c627a92ad1ab']),
('1/4 Acre Development Land', 'Prime plot with ready title deed, water and electricity nearby.', 'sale', 'land', 1200000.00, 'Marsabit Outskirts', 'available', ARRAY['https://images.unsplash.com/photo-1500382017468-9049fed747ef']);


-- =======================================================
-- Administrator Module extension
-- (also available as supabase/migrations/20260708000000_admin_module.sql)
-- Tables + RLS for: audit logging, expenses, system settings,
-- backups, help articles, user invites, and feedback replies.
-- =======================================================

-- Helper: is the current user an admin OR finance officer?
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

-- 9. Audit Logs
CREATE TABLE public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs (action);

CREATE POLICY "Users can insert their own audit entries" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

-- 10. Expenses
CREATE TABLE public.expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('maintenance', 'utilities', 'salaries', 'supplies', 'marketing', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  incurred_on DATE NOT NULL DEFAULT (timezone('utc'::text, now())::date),
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE INDEX expenses_incurred_on_idx ON public.expenses (incurred_on DESC);

CREATE POLICY "Admins and Finance can view expenses" ON public.expenses
  FOR SELECT TO authenticated USING ((SELECT private.is_admin_or_finance()));

CREATE POLICY "Admins and Finance can modify expenses" ON public.expenses
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin_or_finance()))
  WITH CHECK ((SELECT private.is_admin_or_finance()));

-- 11. System Settings
CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  data_type TEXT NOT NULL DEFAULT 'text' CHECK (data_type IN ('text', 'number', 'boolean')),
  updated_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read settings" ON public.system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can modify settings" ON public.system_settings
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

INSERT INTO public.system_settings (key, value, label, description, category, data_type) VALUES
  ('company_name', 'IBSA Homes', 'Company Name', 'Displayed across the app and on reports.', 'general', 'text'),
  ('support_email', 'support@ibsahomes.com', 'Support Email', 'Contact address shown to users needing help.', 'general', 'text'),
  ('support_phone', '+254700000000', 'Support Phone', 'Contact phone number for user support.', 'general', 'text'),
  ('currency_code', 'KES', 'Currency Code', 'Currency used for prices and financial reports.', 'financial', 'text'),
  ('low_stock_threshold', '5', 'Low Stock Threshold', 'Inventory quantity at or below which an item is flagged low stock.', 'operations', 'number'),
  ('maintenance_mode', 'false', 'Maintenance Mode', 'When enabled, shows a maintenance banner to users.', 'system', 'boolean'),
  ('allow_public_signup', 'true', 'Allow Public Sign-up', 'When disabled, new accounts must be invited by an admin.', 'system', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- 12. Backups
CREATE TABLE public.backups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'restored', 'failed')) DEFAULT 'completed',
  table_counts JSONB DEFAULT '{}'::jsonb,
  total_records INTEGER DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view backups" ON public.backups
  FOR SELECT TO authenticated USING ((SELECT private.is_admin()));

CREATE POLICY "Only admins can create backups" ON public.backups
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- 13. Help Articles
CREATE TABLE public.help_articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'staff', 'tenant', 'client')),
  body TEXT NOT NULL,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read help articles" ON public.help_articles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can manage help articles" ON public.help_articles
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- 14. User Invites
CREATE TABLE public.user_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'tenant', 'client')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')) DEFAULT 'pending',
  invited_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read invites" ON public.user_invites
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can accept their own invite" ON public.user_invites
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Only admins can create invites" ON public.user_invites
  FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Only admins can delete invites" ON public.user_invites
  FOR DELETE TO authenticated USING ((SELECT private.is_admin()));

-- Feedback: replies + resolution + admin update/delete
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  ADD COLUMN IF NOT EXISTS admin_reply TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS replied_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE POLICY "Admins can update feedback" ON public.feedback
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Admins can delete feedback" ON public.feedback
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- Profiles: admin delete
CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));


-- =======================================================
-- Landlord Module extension
-- (also available as supabase/migrations/20260709000000_landlord_module.sql)
-- Adds a scoped multi-landlord role: property ownership, a
-- units table, lease/maintenance columns, and RLS so each
-- landlord sees only their own data.
-- =======================================================

-- Allow the new 'landlord' role everywhere role is checked
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'finance', 'tenant', 'client', 'landlord'));

ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_role_check;
ALTER TABLE public.user_invites
  ADD CONSTRAINT user_invites_role_check
  CHECK (role IN ('admin', 'finance', 'tenant', 'client', 'landlord'));

-- Helper: is the current user a landlord?
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

-- Property ownership (existing seeded rows stay NULL = agency-owned)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON public.properties (owner_id);

CREATE POLICY "Landlords can insert their own properties" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (auth.jwt()->>'sub') AND (SELECT private.is_landlord()));

CREATE POLICY "Landlords can update their own properties" ON public.properties
  FOR UPDATE TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

CREATE POLICY "Landlords can delete their own properties" ON public.properties
  FOR DELETE TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'));

-- 15. Units (Unit Management)
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

CREATE POLICY "Landlords can manage their own units" ON public.units
  FOR ALL TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

CREATE POLICY "Tenants can view their assigned unit" ON public.units
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->>'sub'));

CREATE POLICY "Admins can manage all units" ON public.units
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- Leases: ownership + unit link + contract + terms (Rental Agreement Management)
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_url TEXT,
  ADD COLUMN IF NOT EXISTS terms TEXT;

CREATE INDEX IF NOT EXISTS leases_owner_id_idx ON public.leases (owner_id);

CREATE POLICY "Landlords can view their own leases" ON public.leases
  FOR SELECT TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'));

CREATE POLICY "Landlords can manage their own leases" ON public.leases
  FOR ALL TO authenticated
  USING (owner_id = (auth.jwt()->>'sub'))
  WITH CHECK (owner_id = (auth.jwt()->>'sub'));

-- Payments: landlords see/verify payments on their own leases
CREATE POLICY "Landlords can view payments on their leases" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases
      WHERE leases.id = payments.lease_id
        AND leases.owner_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Landlords can verify payments on their leases" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases
      WHERE leases.id = payments.lease_id
        AND leases.owner_id = (auth.jwt()->>'sub')
    )
  );

-- Maintenance requests: landlords handle requests on properties they own
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;

CREATE POLICY "Landlords can view requests on their properties" ON public.maintenance_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = maintenance_requests.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Landlords can update requests on their properties" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = maintenance_requests.property_id
        AND properties.owner_id = (auth.jwt()->>'sub')
    )
  );

-- Cross-cutting access: landlords can browse tenant/client profiles (to assign
-- leases + resolve profile joins) and pre-register tenants by email.
CREATE POLICY "Landlords can view tenant and client profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_landlord()) AND role IN ('tenant', 'client'));

CREATE POLICY "Landlords can invite tenants" ON public.user_invites
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_landlord()) AND role = 'tenant');

-- =======================================================
-- Tenant Module extension
-- (also available as supabase/migrations/20260710000000_tenant_module.sql)
-- Adds tenant profile fields, notifications, maintenance
-- confirmation, and storage policies for tenant uploads.
-- =======================================================

-- Tenant profile fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS id_number TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- 16. Notifications
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

CREATE POLICY "Users can view their own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can update their own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (auth.jwt()->>'sub'))
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

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

-- Maintenance confirmation by tenant
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS tenant_confirmed_at TIMESTAMP WITH TIME ZONE;

CREATE POLICY "Tenants can confirm resolved requests" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt()->>'sub') AND status = 'resolved')
  WITH CHECK (tenant_id = (auth.jwt()->>'sub'));

CREATE POLICY "Tenants can attach images to own requests" ON public.maintenance_requests
  FOR UPDATE TO authenticated
  USING (
    tenant_id = (auth.jwt()->>'sub')
    AND status IN ('pending', 'in_progress')
  )
  WITH CHECK (tenant_id = (auth.jwt()->>'sub'));

-- Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('maintenance-images', 'maintenance-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can read own avatars" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

CREATE POLICY "Users can upload own avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

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

CREATE POLICY "Users can delete own avatars" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

CREATE POLICY "Anyone can read maintenance images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'maintenance-images');

CREATE POLICY "Users can upload own maintenance images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

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

CREATE POLICY "Users can delete own maintenance images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'maintenance-images'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

-- =======================================================
-- Systematic Flow completion
-- (also available as supabase/migrations/20260711000000_flow_completion.sql)
-- Booking lifecycle statuses, inventory usage tracking for
-- maintenance materials, and booking notifications.
-- =======================================================

-- Booking lifecycle statuses
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'completed', 'cancelled'));

-- 17. Inventory Usages (maintenance materials tracking)
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

CREATE POLICY "Admins and Finance can view inventory usage" ON public.inventory_usages
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

CREATE POLICY "Admins can manage inventory usage" ON public.inventory_usages
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

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

CREATE POLICY "Landlords can view their own inventory usage" ON public.inventory_usages
  FOR SELECT TO authenticated
  USING (used_by = (auth.jwt()->>'sub'));

CREATE POLICY "Landlords can view inventory" ON public.inventory
  FOR SELECT TO authenticated
  USING ((SELECT private.is_landlord()));

-- Decrement stock automatically whenever usage is recorded.
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

-- Booking notifications: new type + staff may notify clients
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

-- =======================================================
-- Landlord follow-ups (migrations 120, 140–160, 180)
-- Kept in sync with supabase/migrations for bootstrap.
-- =======================================================

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

-- =======================================================
-- Pending leases (activate on verified payment) +
-- prevent overlapping pending/active leases on the same
-- unit or whole-property rental.
-- =======================================================

-- -------------------------------------------------------
-- 1. Allow status = pending; default new leases to pending
-- -------------------------------------------------------
ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_status_check;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_status_check
  CHECK (status IN ('pending', 'active', 'terminated', 'expired'));

ALTER TABLE public.leases
  ALTER COLUMN status SET DEFAULT 'pending';

-- -------------------------------------------------------
-- 2. Clean up duplicate overlapping active leases
--    Keep the longer (then newer) lease; terminate losers.
-- -------------------------------------------------------
WITH unit_overlap AS (
  SELECT DISTINCT a.id AS loser_id
  FROM public.leases AS a
  JOIN public.leases AS b
    ON a.unit_id = b.unit_id
   AND a.id <> b.id
   AND a.status = 'active'
   AND b.status = 'active'
   AND a.unit_id IS NOT NULL
   AND a.start_date <= b.end_date
   AND b.start_date <= a.end_date
   AND (
     a.end_date < b.end_date
     OR (a.end_date = b.end_date AND COALESCE(a.created_at, '-infinity'::timestamptz) < COALESCE(b.created_at, '-infinity'::timestamptz))
     OR (
       a.end_date = b.end_date
       AND a.created_at IS NOT DISTINCT FROM b.created_at
       AND a.id < b.id
     )
   )
),
property_overlap AS (
  SELECT DISTINCT a.id AS loser_id
  FROM public.leases AS a
  JOIN public.leases AS b
    ON a.property_id = b.property_id
   AND a.id <> b.id
   AND a.status = 'active'
   AND b.status = 'active'
   AND a.unit_id IS NULL
   AND b.unit_id IS NULL
   AND a.start_date <= b.end_date
   AND b.start_date <= a.end_date
   AND (
     a.end_date < b.end_date
     OR (a.end_date = b.end_date AND COALESCE(a.created_at, '-infinity'::timestamptz) < COALESCE(b.created_at, '-infinity'::timestamptz))
     OR (
       a.end_date = b.end_date
       AND a.created_at IS NOT DISTINCT FROM b.created_at
       AND a.id < b.id
     )
   )
)
UPDATE public.leases
SET status = 'terminated'
WHERE id IN (
  SELECT loser_id FROM unit_overlap
  UNION
  SELECT loser_id FROM property_overlap
);

-- -------------------------------------------------------
-- 3. Overlap guard (pending + active)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prevent_overlapping_leases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' AND NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Lease end date must be on or after start date'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.unit_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.leases AS l
      WHERE l.unit_id = NEW.unit_id
        AND l.id IS DISTINCT FROM NEW.id
        AND l.status IN ('pending', 'active')
        AND l.start_date <= NEW.end_date
        AND NEW.start_date <= l.end_date
    ) THEN
      RAISE EXCEPTION 'This unit already has an overlapping pending or active lease'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.leases AS l
      WHERE l.property_id = NEW.property_id
        AND l.unit_id IS NULL
        AND l.id IS DISTINCT FROM NEW.id
        AND l.status IN ('pending', 'active')
        AND l.start_date <= NEW.end_date
        AND NEW.start_date <= l.end_date
    ) THEN
      RAISE EXCEPTION 'This property already has an overlapping pending or active lease'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leases_prevent_overlap ON public.leases;
CREATE TRIGGER trg_leases_prevent_overlap
  BEFORE INSERT OR UPDATE OF unit_id, property_id, start_date, end_date, status
  ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_overlapping_leases();

REVOKE EXECUTE ON FUNCTION private.prevent_overlapping_leases() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------
-- 4. Activate pending lease when payment is verified
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.activate_lease_on_payment_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified')
     AND NEW.lease_id IS NOT NULL
  THEN
    UPDATE public.leases
    SET status = 'active'
    WHERE id = NEW.lease_id
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_activate_lease ON public.payments;
CREATE TRIGGER trg_payments_activate_lease
  AFTER INSERT OR UPDATE OF status
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION private.activate_lease_on_payment_verified();

REVOKE EXECUTE ON FUNCTION private.activate_lease_on_payment_verified() FROM PUBLIC, anon, authenticated;

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

-- Public-safe helpers for pre-auth signup checks (see migration 20260719000000)
CREATE OR REPLACE FUNCTION public.get_system_setting(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value
  FROM public.system_settings
  WHERE key = p_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_system_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_system_setting(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_pending_invite_role(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_invites
  WHERE email = lower(trim(p_email))
    AND status = 'pending'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_pending_invite_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invite_role(text) TO anon, authenticated;

-- =======================================================
-- Tenant portal hardening (migration 20260720000000)
-- =======================================================

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

  IF v_role NOT IN ('admin', 'finance', 'landlord', 'tenant', 'client') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

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
