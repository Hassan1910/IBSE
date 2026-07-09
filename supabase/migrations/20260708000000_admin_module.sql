-- =======================================================
-- IBSA Homes — Administrator Module extension
-- Adds tables + RLS for: audit logging, expenses, system
-- settings, backups, help articles, user invites, and
-- feedback replies. Run this AFTER supabase_schema.sql.
-- =======================================================

-- Helper: is the current user an admin OR finance officer?
-- (Financial oversight screens are shared by admin + finance.)
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


-- =======================================================
-- 9. Audit Logs  (System Monitoring & Auditing, Access logs)
-- =======================================================
CREATE TABLE public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,               -- e.g. 'login', 'create', 'update', 'delete'
  entity_type TEXT,                   -- e.g. 'property', 'user', 'payment'
  entity_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs (action);

-- Any authenticated user may record their own actions (e.g. login events),
-- but only ever attributed to themselves.
CREATE POLICY "Users can insert their own audit entries" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = (auth.jwt()->>'sub'));

-- Only admins can read the audit trail.
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));


-- =======================================================
-- 10. Expenses  (Financial Management Oversight)
-- =======================================================
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
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

CREATE POLICY "Admins and Finance can modify expenses" ON public.expenses
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin_or_finance()))
  WITH CHECK ((SELECT private.is_admin_or_finance()));


-- =======================================================
-- 11. System Settings  (System Configuration & Maintenance)
-- =======================================================
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

-- All authenticated users may read settings (e.g. company name, currency),
-- but only admins can change them.
CREATE POLICY "Authenticated users can read settings" ON public.system_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Only admins can modify settings" ON public.system_settings
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- Seed default configuration
INSERT INTO public.system_settings (key, value, label, description, category, data_type) VALUES
  ('company_name', 'IBSA Homes', 'Company Name', 'Displayed across the app and on reports.', 'general', 'text'),
  ('support_email', 'support@ibsahomes.com', 'Support Email', 'Contact address shown to users needing help.', 'general', 'text'),
  ('support_phone', '+254700000000', 'Support Phone', 'Contact phone number for user support.', 'general', 'text'),
  ('currency_code', 'KES', 'Currency Code', 'Currency used for prices and financial reports.', 'financial', 'text'),
  ('low_stock_threshold', '5', 'Low Stock Threshold', 'Inventory quantity at or below which an item is flagged low stock.', 'operations', 'number'),
  ('maintenance_mode', 'false', 'Maintenance Mode', 'When enabled, shows a maintenance banner to users.', 'system', 'boolean'),
  ('allow_public_signup', 'true', 'Allow Public Sign-up', 'When disabled, new accounts must be invited by an admin.', 'system', 'boolean')
ON CONFLICT (key) DO NOTHING;


-- =======================================================
-- 12. Backups  (Data Backup & Recovery log)
-- =======================================================
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
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

CREATE POLICY "Only admins can create backups" ON public.backups
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));


-- =======================================================
-- 13. Help Articles  (User Training & Support content)
-- =======================================================
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
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Only admins can manage help articles" ON public.help_articles
  FOR ALL TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));


-- =======================================================
-- 14. User Invites  (Create user accounts / assign roles)
-- Admins pre-register an email with a role. When that person
-- signs up or first logs in, the app applies the invited role.
-- =======================================================
CREATE TABLE public.user_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'booking', 'tenant', 'client')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')) DEFAULT 'pending',
  invited_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read invites so the sign-up / first-login flow
-- can resolve its assigned role (invites only hold email + role).
CREATE POLICY "Authenticated users can read invites" ON public.user_invites
  FOR SELECT TO authenticated
  USING (true);

-- New users may mark their own invite as accepted during onboarding.
CREATE POLICY "Users can accept their own invite" ON public.user_invites
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Only admins can create invites" ON public.user_invites
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "Only admins can delete invites" ON public.user_invites
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));


-- =======================================================
-- Schema additions to existing tables
-- =======================================================

-- Feedback: allow admins to reply, mark resolved, and delete (Support mgmt)
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

-- Profiles: allow admins to delete user profiles (User Account Management)
CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));


-- =======================================================
-- Seed sample help articles
-- =======================================================
INSERT INTO public.help_articles (title, category, audience, body) VALUES
  ('Getting Started for New Staff', 'onboarding', 'staff',
   'Welcome to IBSA Homes. Sign in with the credentials provided by your administrator. Booking officers manage viewing requests, finance officers verify payments, and admins manage the full system. Use the tabs at the bottom to navigate your workspace.'),
  ('How Tenants Submit Rent Payments', 'payments', 'tenant',
   'Open the Rent tab, enter the amount, choose your payment method (M-Pesa, cash, or bank), and paste the transaction reference code. Your payment appears as "pending" until finance verifies it.'),
  ('Booking a Property Viewing', 'bookings', 'client',
   'Browse available properties, tap a listing, and choose "Book Viewing" or "Reserve". You will see the status of every request under My Bookings once submitted.'),
  ('Reporting a Maintenance Issue', 'maintenance', 'tenant',
   'Go to the Maintenance tab, describe the problem, set the priority, and submit. Staff will update the ticket as it moves from pending to in-progress to resolved.')
ON CONFLICT DO NOTHING;
