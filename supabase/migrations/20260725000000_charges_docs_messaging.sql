-- =======================================================
-- Money depth, documents, messaging (no M-Pesa STK)
-- - Payment proof + receipt URLs
-- - Lease deposits + charges + balance RPC
-- - Lease document vault
-- - Lease-scoped messaging
-- - Landlord report summary with date filters
-- =======================================================

-- -------------------------------------------------------
-- 1. Payments: proof + receipt
-- -------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- -------------------------------------------------------
-- 2. Lease deposits
-- -------------------------------------------------------
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leases' AND column_name = 'deposit_status'
  ) THEN
    ALTER TABLE public.leases
      ADD COLUMN deposit_status TEXT NOT NULL DEFAULT 'none';
  END IF;
END $$;

ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_deposit_status_check;
ALTER TABLE public.leases
  ADD CONSTRAINT leases_deposit_status_check
  CHECK (deposit_status IN ('none', 'due', 'held', 'refunded', 'partial'));

UPDATE public.leases
SET deposit_status = CASE
  WHEN deposit_amount > 0 AND deposit_status = 'none' THEN 'due'
  ELSE deposit_status
END;

-- -------------------------------------------------------
-- 3. Charges (billable line items)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.charges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('rent', 'deposit', 'late_fee', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  due_date DATE,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'waived')) DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS charges_lease_id_idx ON public.charges (lease_id);
CREATE INDEX IF NOT EXISTS charges_status_idx ON public.charges (status);

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants can view charges on their leases" ON public.charges;
CREATE POLICY "Tenants can view charges on their leases" ON public.charges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = charges.lease_id
        AND l.tenant_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Landlords can view charges on owned leases" ON public.charges;
CREATE POLICY "Landlords can view charges on owned leases" ON public.charges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = charges.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Admins and finance can view all charges" ON public.charges;
CREATE POLICY "Admins and finance can view all charges" ON public.charges
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

DROP POLICY IF EXISTS "Staff can manage charges" ON public.charges;
CREATE POLICY "Staff can manage charges" ON public.charges
  FOR ALL TO authenticated
  USING (
    (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = charges.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
        AND (SELECT private.is_landlord())
    )
  )
  WITH CHECK (
    (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = charges.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
        AND (SELECT private.is_landlord())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.charges TO authenticated;

-- Month count helper matching app leaseMonthCount (minimum 1)
CREATE OR REPLACE FUNCTION private.lease_month_count(p_start date, p_end date)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  months integer;
BEGIN
  months := (EXTRACT(YEAR FROM age(p_end, p_start))::int * 12)
          + EXTRACT(MONTH FROM age(p_end, p_start))::int;
  IF EXTRACT(DAY FROM p_end) < EXTRACT(DAY FROM p_start) THEN
    months := months - 1;
  END IF;
  RETURN GREATEST(1, months);
END;
$$;

REVOKE EXECUTE ON FUNCTION private.lease_month_count(date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.seed_lease_charges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rent_total numeric;
  months int;
BEGIN
  months := private.lease_month_count(NEW.start_date, NEW.end_date);
  rent_total := COALESCE(NEW.rent_amount, 0) * months;

  INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
  VALUES (
    NEW.id,
    'rent',
    format('Rent for %s months', months),
    rent_total,
    NEW.start_date,
    'open'
  );

  IF COALESCE(NEW.deposit_amount, 0) > 0 THEN
    INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
    VALUES (
      NEW.id,
      'deposit',
      'Security deposit',
      NEW.deposit_amount,
      NEW.start_date,
      'open'
    );
    IF NEW.deposit_status = 'none' THEN
      UPDATE public.leases SET deposit_status = 'due' WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_lease_charges ON public.leases;
CREATE TRIGGER trg_seed_lease_charges
  AFTER INSERT ON public.leases
  FOR EACH ROW
  EXECUTE FUNCTION private.seed_lease_charges();

REVOKE EXECUTE ON FUNCTION private.seed_lease_charges() FROM PUBLIC, anon, authenticated;

-- Backfill charges for existing leases that have none
INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
SELECT
  l.id,
  'rent',
  format('Rent for %s months', private.lease_month_count(l.start_date, l.end_date)),
  l.rent_amount * private.lease_month_count(l.start_date, l.end_date),
  l.start_date,
  'open'
FROM public.leases l
WHERE NOT EXISTS (
  SELECT 1 FROM public.charges c WHERE c.lease_id = l.id AND c.charge_type = 'rent'
);

INSERT INTO public.charges (lease_id, charge_type, description, amount, due_date, status)
SELECT
  l.id,
  'deposit',
  'Security deposit',
  l.deposit_amount,
  l.start_date,
  'open'
FROM public.leases l
WHERE COALESCE(l.deposit_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.charges c WHERE c.lease_id = l.id AND c.charge_type = 'deposit'
  );

-- Mark deposit held when verified payments cover deposit charge
CREATE OR REPLACE FUNCTION private.sync_deposit_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deposit_due numeric;
  paid_total numeric;
BEGIN
  IF NEW.lease_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'verified' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'verified' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO deposit_due
  FROM public.charges
  WHERE lease_id = NEW.lease_id
    AND charge_type = 'deposit'
    AND status <> 'waived';

  IF deposit_due <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO paid_total
  FROM public.payments
  WHERE lease_id = NEW.lease_id
    AND status = 'verified';

  IF paid_total >= deposit_due THEN
    UPDATE public.leases
    SET deposit_status = 'held'
    WHERE id = NEW.lease_id
      AND deposit_status IN ('none', 'due', 'partial');

    UPDATE public.charges
    SET status = 'paid'
    WHERE lease_id = NEW.lease_id
      AND charge_type = 'deposit'
      AND status = 'open';
  ELSIF paid_total > 0 THEN
    UPDATE public.leases
    SET deposit_status = 'partial'
    WHERE id = NEW.lease_id
      AND deposit_status IN ('none', 'due');
  END IF;

  -- Mark rent charges paid when fully covered (after deposit)
  IF paid_total >= (
    SELECT COALESCE(SUM(amount), 0) FROM public.charges
    WHERE lease_id = NEW.lease_id AND status <> 'waived'
  ) THEN
    UPDATE public.charges
    SET status = 'paid'
    WHERE lease_id = NEW.lease_id
      AND status = 'open';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deposit_on_payment ON public.payments;
CREATE TRIGGER trg_sync_deposit_on_payment
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_deposit_on_payment();

REVOKE EXECUTE ON FUNCTION private.sync_deposit_on_payment() FROM PUBLIC, anon, authenticated;

-- Lease balance RPC
CREATE OR REPLACE FUNCTION public.lease_balance(p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller text := (auth.jwt()->>'sub');
  lease_row public.leases%ROWTYPE;
  charges_total numeric;
  paid_total numeric;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO lease_row FROM public.leases WHERE id = p_lease_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lease not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    lease_row.tenant_id = caller
    OR (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = lease_row.property_id AND p.owner_id = caller
    )
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO charges_total
  FROM public.charges
  WHERE lease_id = p_lease_id AND status <> 'waived';

  SELECT COALESCE(SUM(amount), 0) INTO paid_total
  FROM public.payments
  WHERE lease_id = p_lease_id AND status = 'verified';

  RETURN jsonb_build_object(
    'charges_total', charges_total,
    'paid_total', paid_total,
    'outstanding', GREATEST(charges_total - paid_total, 0),
    'deposit_amount', COALESCE(lease_row.deposit_amount, 0),
    'deposit_status', lease_row.deposit_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lease_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lease_balance(uuid) TO authenticated;

-- -------------------------------------------------------
-- 4. Lease document vault
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('contract', 'id', 'inspection', 'receipt', 'other')),
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS lease_documents_lease_id_idx ON public.lease_documents (lease_id);

ALTER TABLE public.lease_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lease parties can view documents" ON public.lease_documents;
CREATE POLICY "Lease parties can view documents" ON public.lease_documents
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = lease_documents.lease_id
        AND l.tenant_id = (auth.jwt()->>'sub')
    )
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = lease_documents.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Staff can upload lease documents" ON public.lease_documents;
CREATE POLICY "Staff can upload lease documents" ON public.lease_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = lease_documents.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
        AND (SELECT private.is_landlord())
    )
  );

DROP POLICY IF EXISTS "Staff can delete lease documents" ON public.lease_documents;
CREATE POLICY "Staff can delete lease documents" ON public.lease_documents
  FOR DELETE TO authenticated
  USING (
    (SELECT private.is_admin_or_finance())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = lease_documents.lease_id
        AND p.owner_id = (auth.jwt()->>'sub')
        AND (SELECT private.is_landlord())
    )
  );

GRANT SELECT, INSERT, DELETE ON public.lease_documents TO authenticated;

-- Backfill contract_url into vault
INSERT INTO public.lease_documents (lease_id, doc_type, title, file_url, uploaded_by)
SELECT l.id, 'contract', 'Lease contract', l.contract_url, l.owner_id
FROM public.leases l
WHERE l.contract_url IS NOT NULL
  AND l.contract_url <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.lease_documents d
    WHERE d.lease_id = l.id AND d.doc_type = 'contract' AND d.file_url = l.contract_url
  );

-- -------------------------------------------------------
-- 5. Lease-scoped messaging
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (lease_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON public.messages (thread_id, created_at);

ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.can_access_lease_thread(p_lease_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = p_lease_id AND l.tenant_id = (auth.jwt()->>'sub')
    )
    OR EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.properties p ON p.id = l.property_id
      WHERE l.id = p_lease_id AND p.owner_id = (auth.jwt()->>'sub')
    );
$$;

REVOKE EXECUTE ON FUNCTION private.can_access_lease_thread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_lease_thread(uuid) TO authenticated;

DROP POLICY IF EXISTS "Parties can view lease threads" ON public.message_threads;
CREATE POLICY "Parties can view lease threads" ON public.message_threads
  FOR SELECT TO authenticated
  USING ((SELECT private.can_access_lease_thread(lease_id)));

DROP POLICY IF EXISTS "Parties can create lease threads" ON public.message_threads;
CREATE POLICY "Parties can create lease threads" ON public.message_threads
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_access_lease_thread(lease_id)));

DROP POLICY IF EXISTS "Parties can update lease threads" ON public.message_threads;
CREATE POLICY "Parties can update lease threads" ON public.message_threads
  FOR UPDATE TO authenticated
  USING ((SELECT private.can_access_lease_thread(lease_id)))
  WITH CHECK ((SELECT private.can_access_lease_thread(lease_id)));

DROP POLICY IF EXISTS "Parties can view messages" ON public.messages;
CREATE POLICY "Parties can view messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = messages.thread_id
        AND (SELECT private.can_access_lease_thread(t.lease_id))
    )
  );

DROP POLICY IF EXISTS "Parties can send messages" ON public.messages;
CREATE POLICY "Parties can send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (auth.jwt()->>'sub')
    AND EXISTS (
      SELECT 1 FROM public.message_threads t
      WHERE t.id = messages.thread_id
        AND (SELECT private.can_access_lease_thread(t.lease_id))
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.message_threads TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_lease_thread(p_lease_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread uuid;
  v_property uuid;
BEGIN
  IF NOT (SELECT private.can_access_lease_thread(p_lease_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_thread FROM public.message_threads WHERE lease_id = p_lease_id;
  IF v_thread IS NOT NULL THEN
    RETURN v_thread;
  END IF;

  SELECT property_id INTO v_property FROM public.leases WHERE id = p_lease_id;
  IF v_property IS NULL THEN
    RAISE EXCEPTION 'lease not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.message_threads (lease_id, property_id)
  VALUES (p_lease_id, v_property)
  RETURNING id INTO v_thread;

  RETURN v_thread;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_lease_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_lease_thread(uuid) TO authenticated;

-- -------------------------------------------------------
-- 6. Notification type: message
-- -------------------------------------------------------
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
      'booking_update',
      'message'
    )
  );

-- -------------------------------------------------------
-- 7. Storage buckets
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'payment-proofs',
    'payment-proofs',
    true,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
  ),
  (
    'payment-receipts',
    'payment-receipts',
    true,
    10485760,
    ARRAY['application/pdf']
  ),
  (
    'lease-documents',
    'lease-documents',
    true,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read payment proofs" ON storage.objects;
CREATE POLICY "Authenticated can read payment proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs');

DROP POLICY IF EXISTS "Payers can upload payment proofs" ON storage.objects;
CREATE POLICY "Payers can upload payment proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND split_part(name, '/', 1) = (auth.jwt()->>'sub')
  );

DROP POLICY IF EXISTS "Authenticated can read payment receipts" ON storage.objects;
CREATE POLICY "Authenticated can read payment receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts');

DROP POLICY IF EXISTS "Staff can upload payment receipts" ON storage.objects;
CREATE POLICY "Staff can upload payment receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (SELECT private.is_landlord())
    )
  );

DROP POLICY IF EXISTS "Authenticated can read lease documents storage" ON storage.objects;
CREATE POLICY "Authenticated can read lease documents storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lease-documents');

DROP POLICY IF EXISTS "Staff can upload lease documents storage" ON storage.objects;
CREATE POLICY "Staff can upload lease documents storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (SELECT private.is_landlord())
    )
  );

DROP POLICY IF EXISTS "Staff can update lease documents storage" ON storage.objects;
CREATE POLICY "Staff can update lease documents storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (SELECT private.is_landlord())
    )
  )
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR (SELECT private.is_landlord())
    )
  );

-- -------------------------------------------------------
-- 8. Landlord report summary (date-filtered income)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landlord_report_summary(
  p_owner_id text,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller text := (auth.jwt()->>'sub');
  result jsonb;
BEGIN
  IF caller IS NULL OR caller <> p_owner_id THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT (SELECT private.is_landlord()) AND NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'income', jsonb_build_object(
      'verified_collected', COALESCE((
        SELECT SUM(pay.amount)::numeric
        FROM public.payments pay
        JOIN public.leases l ON l.id = pay.lease_id
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = p_owner_id
          AND pay.status = 'verified'
          AND (p_from IS NULL OR pay.payment_date::date >= p_from)
          AND (p_to IS NULL OR pay.payment_date::date <= p_to)
      ), 0),
      'pending_amount', COALESCE((
        SELECT SUM(pay.amount)::numeric
        FROM public.payments pay
        JOIN public.leases l ON l.id = pay.lease_id
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = p_owner_id
          AND pay.status = 'pending'
          AND (p_from IS NULL OR pay.payment_date::date >= p_from)
          AND (p_to IS NULL OR pay.payment_date::date <= p_to)
      ), 0),
      'payments_count', COALESCE((
        SELECT COUNT(*)::int
        FROM public.payments pay
        JOIN public.leases l ON l.id = pay.lease_id
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = p_owner_id
          AND (p_from IS NULL OR pay.payment_date::date >= p_from)
          AND (p_to IS NULL OR pay.payment_date::date <= p_to)
      ), 0)
    ),
    'occupancy', jsonb_build_object(
      'total_properties', (
        SELECT COUNT(*)::int FROM public.properties WHERE owner_id = p_owner_id
      ),
      'active_leases', (
        SELECT COUNT(*)::int
        FROM public.leases l
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = p_owner_id AND l.status = 'active'
      ),
      'pending_leases', (
        SELECT COUNT(*)::int
        FROM public.leases l
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = p_owner_id AND l.status = 'pending'
      ),
      'occupied_units', (
        SELECT COUNT(*)::int
        FROM public.units u
        JOIN public.properties p ON p.id = u.property_id
        WHERE p.owner_id = p_owner_id AND u.status = 'occupied'
      ),
      'vacant_units', (
        SELECT COUNT(*)::int
        FROM public.units u
        JOIN public.properties p ON p.id = u.property_id
        WHERE p.owner_id = p_owner_id AND u.status = 'vacant'
      )
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.landlord_report_summary(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.landlord_report_summary(text, date, date) TO authenticated;
