-- In-app property purchase: proof upload → staff verify → mark sold + sale docs vault.

-- -------------------------------------------------------
-- 1. property_purchases
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'bank', 'cash')),
  reference_code TEXT NOT NULL,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed')),
  notes TEXT,
  verified_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT property_purchases_reference_code_key UNIQUE (reference_code)
);

CREATE INDEX IF NOT EXISTS property_purchases_buyer_id_idx
  ON public.property_purchases (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS property_purchases_property_id_idx
  ON public.property_purchases (property_id, status);

CREATE INDEX IF NOT EXISTS property_purchases_pending_idx
  ON public.property_purchases (status, created_at ASC)
  WHERE status = 'pending';

-- At most one pending purchase per buyer per property.
CREATE UNIQUE INDEX IF NOT EXISTS property_purchases_pending_buyer_property_uidx
  ON public.property_purchases (property_id, buyer_id)
  WHERE status = 'pending';

-- At most one verified purchase per property.
CREATE UNIQUE INDEX IF NOT EXISTS property_purchases_verified_property_uidx
  ON public.property_purchases (property_id)
  WHERE status = 'verified';

CREATE OR REPLACE FUNCTION public.enforce_property_purchase_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
  v_status TEXT;
  v_price NUMERIC;
BEGIN
  SELECT type, status, price INTO v_type, v_status, v_price
  FROM public.properties
  WHERE id = NEW.property_id;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Property not found' USING ERRCODE = '23503';
  END IF;
  IF v_type <> 'sale' THEN
    RAISE EXCEPTION 'Only sale listings can be purchased' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Property is not available for purchase' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Property has no valid sale price' USING ERRCODE = '22023';
  END IF;

  NEW.buyer_id := auth.jwt()->>'sub';
  NEW.amount := v_price;
  NEW.status := 'pending';
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_property_purchase_insert ON public.property_purchases;
CREATE TRIGGER trg_enforce_property_purchase_insert
  BEFORE INSERT ON public.property_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_property_purchase_insert();

ALTER TABLE public.property_purchases ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.property_purchases TO authenticated;

DROP POLICY IF EXISTS "Buyers can view own purchases" ON public.property_purchases;
CREATE POLICY "Buyers can view own purchases" ON public.property_purchases
  FOR SELECT TO authenticated
  USING (buyer_id = (auth.jwt()->>'sub'));

DROP POLICY IF EXISTS "Staff can view all purchases" ON public.property_purchases;
CREATE POLICY "Staff can view all purchases" ON public.property_purchases
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

DROP POLICY IF EXISTS "Landlords can view purchases on owned properties" ON public.property_purchases;
CREATE POLICY "Landlords can view purchases on owned properties" ON public.property_purchases
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_landlord())
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_purchases.property_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Buyers can submit purchases" ON public.property_purchases;
CREATE POLICY "Buyers can submit purchases" ON public.property_purchases
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id = (auth.jwt()->>'sub')
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = (auth.jwt()->>'sub')
        AND pr.account_status = 'approved'
    )
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id
        AND p.type = 'sale'
        AND p.status = 'available'
    )
  );

DROP POLICY IF EXISTS "Staff can update purchases" ON public.property_purchases;
CREATE POLICY "Staff can update purchases" ON public.property_purchases
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin_or_finance()))
  WITH CHECK ((SELECT private.is_admin_or_finance()));

-- -------------------------------------------------------
-- 2. purchase_documents
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id UUID NOT NULL REFERENCES public.property_purchases(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('sale_agreement', 'id', 'receipt', 'other')),
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS purchase_documents_purchase_id_idx
  ON public.purchase_documents (purchase_id);

ALTER TABLE public.purchase_documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.purchase_documents TO authenticated;

DROP POLICY IF EXISTS "Buyers can view own purchase documents" ON public.purchase_documents;
CREATE POLICY "Buyers can view own purchase documents" ON public.purchase_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.property_purchases pp
      WHERE pp.id = purchase_documents.purchase_id
        AND pp.buyer_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Staff can view purchase documents" ON public.purchase_documents;
CREATE POLICY "Staff can view purchase documents" ON public.purchase_documents
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

DROP POLICY IF EXISTS "Landlords can view purchase documents on owned properties" ON public.purchase_documents;
CREATE POLICY "Landlords can view purchase documents on owned properties" ON public.purchase_documents
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_landlord())
    AND EXISTS (
      SELECT 1
      FROM public.property_purchases pp
      JOIN public.properties p ON p.id = pp.property_id
      WHERE pp.id = purchase_documents.purchase_id
        AND p.owner_id = (auth.jwt()->>'sub')
    )
  );

DROP POLICY IF EXISTS "Staff can upload purchase documents" ON public.purchase_documents;
CREATE POLICY "Staff can upload purchase documents" ON public.purchase_documents
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin_or_finance()));

DROP POLICY IF EXISTS "Staff can delete purchase documents" ON public.purchase_documents;
CREATE POLICY "Staff can delete purchase documents" ON public.purchase_documents
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin_or_finance()));

-- -------------------------------------------------------
-- 3. complete / reject RPCs
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_property_purchase(p_purchase_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id UUID;
  v_status TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can complete a purchase' USING ERRCODE = '42501';
  END IF;

  SELECT property_id, status
  INTO v_property_id, v_status
  FROM public.property_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Purchase is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.property_purchases
  SET
    status = 'verified',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now())
  WHERE id = p_purchase_id;

  UPDATE public.properties
  SET status = 'sold'
  WHERE id = v_property_id;

  UPDATE public.property_purchases
  SET status = 'failed'
  WHERE property_id = v_property_id
    AND status = 'pending'
    AND id <> p_purchase_id;

  RETURN p_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_property_purchase(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_property_purchase(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_property_purchase(
  p_purchase_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_actor TEXT := auth.jwt()->>'sub';
BEGIN
  IF NOT (SELECT private.is_admin_or_finance()) THEN
    RAISE EXCEPTION 'Only admin or finance can reject a purchase' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status
  FROM public.property_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Purchase is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.property_purchases
  SET
    status = 'failed',
    verified_by = v_actor,
    verified_at = timezone('utc'::text, now()),
    notes = COALESCE(NULLIF(trim(p_notes), ''), notes)
  WHERE id = p_purchase_id;

  RETURN p_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_property_purchase(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_property_purchase(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------
-- 4. Notification type
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
      'message',
      'landlord_request',
      'purchase_update'
    )
  );

-- -------------------------------------------------------
-- 5. Storage bucket for sale documents
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'purchase-documents',
  'purchase-documents',
  true,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read purchase documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Purchase parties can read purchase documents storage" ON storage.objects;
CREATE POLICY "Purchase parties can read purchase documents storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (
      (SELECT private.is_admin_or_finance())
      OR EXISTS (
        SELECT 1
        FROM public.property_purchases pp
        WHERE pp.id::text = (storage.foldername(name))[1]
          AND pp.buyer_id = (auth.jwt()->>'sub')
      )
      OR (
        (SELECT private.is_landlord())
        AND EXISTS (
          SELECT 1
          FROM public.property_purchases pp
          JOIN public.properties p ON p.id = pp.property_id
          WHERE pp.id::text = (storage.foldername(name))[1]
            AND p.owner_id = (auth.jwt()->>'sub')
        )
      )
    )
  );

DROP POLICY IF EXISTS "Staff can upload purchase documents storage" ON storage.objects;
CREATE POLICY "Staff can upload purchase documents storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'purchase-documents'
    AND (SELECT private.is_admin_or_finance())
  );

DROP POLICY IF EXISTS "Staff can delete purchase documents storage" ON storage.objects;
CREATE POLICY "Staff can delete purchase documents storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (SELECT private.is_admin_or_finance())
  );
