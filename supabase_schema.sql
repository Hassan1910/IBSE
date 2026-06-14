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
  role TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'booking', 'tenant', 'client')),
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

CREATE POLICY "Booking officers and Admins can view all bookings" ON public.bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'booking')
    )
  );

CREATE POLICY "Booking officers and Admins can update bookings" ON public.bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'booking')
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
  status TEXT NOT NULL CHECK (status IN ('active', 'terminated', 'expired')) DEFAULT 'active',
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
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance', 'booking')
    )
  );

CREATE POLICY "Admins and Staff can update requests" ON public.maintenance_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance', 'booking')
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
      WHERE profiles.id = (auth.jwt()->>'sub') AND profiles.role IN ('admin', 'finance', 'booking')
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
