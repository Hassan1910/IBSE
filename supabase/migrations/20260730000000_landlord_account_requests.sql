-- Landlord account requests: public can submit; admins review and create accounts.

CREATE TABLE IF NOT EXISTS public.landlord_account_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fulfilled', 'dismissed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS landlord_account_requests_status_idx
  ON public.landlord_account_requests (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS landlord_account_requests_pending_email_uidx
  ON public.landlord_account_requests (lower(email))
  WHERE status = 'pending';

ALTER TABLE public.landlord_account_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.landlord_account_requests TO authenticated;

DROP POLICY IF EXISTS "Admins can read landlord account requests"
  ON public.landlord_account_requests;
CREATE POLICY "Admins can read landlord account requests"
  ON public.landlord_account_requests
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS "Admins can update landlord account requests"
  ON public.landlord_account_requests;
CREATE POLICY "Admins can update landlord account requests"
  ON public.landlord_account_requests
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- Allow a dedicated notification type for landlord onboarding requests.
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
      'landlord_request'
    )
  );

-- Public (anon + authenticated) submit path: insert + notify admins.
CREATE OR REPLACE FUNCTION public.submit_landlord_account_request(
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT := trim(COALESCE(p_full_name, ''));
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_phone TEXT := trim(COALESCE(p_phone, ''));
  v_note TEXT := NULLIF(trim(COALESCE(p_note, '')), '');
BEGIN
  IF length(v_name) < 2 THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'A valid email is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) < 7 THEN
    RAISE EXCEPTION 'Phone number is required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
  FROM public.landlord_account_requests
  WHERE lower(email) = v_email AND status = 'pending'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'A pending request for this email already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.landlord_account_requests (full_name, email, phone, note)
  VALUES (v_name, v_email, v_phone, v_note)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT
    id,
    'landlord_request',
    'Landlord account request',
    v_name || ' (' || v_email || ') requested a landlord account.',
    'landlord_account_request',
    v_id::text
  FROM public.profiles
  WHERE role = 'admin';

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_landlord_account_request(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_landlord_account_request(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
