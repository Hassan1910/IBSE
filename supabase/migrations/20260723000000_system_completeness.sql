-- =======================================================
-- System completeness
-- - Viewing-only bookings (drop reservation)
-- - Tighten user_invites RLS
-- - Drop debug get_jwt_sub
-- - Device push tokens
-- - Contracts storage bucket
-- - Low-stock threshold from system_settings
-- - Scheduled rent_due / lease_expiry helpers
-- =======================================================

-- -------------------------------------------------------
-- 1. Bookings: viewing only (migrate reservation → viewing)
-- -------------------------------------------------------
UPDATE public.bookings SET type = 'viewing' WHERE type = 'reservation';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_type_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_type_check CHECK (type IN ('viewing'));

-- booking_id on payments was never used; drop orphan FK
ALTER TABLE public.payments DROP COLUMN IF EXISTS booking_id;

-- -------------------------------------------------------
-- 2. Tighten user_invites RLS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read invites" ON public.user_invites;
DROP POLICY IF EXISTS "Users can accept their own invite" ON public.user_invites;

-- Admins, invite creators, and the invitee (matching JWT email) can read invites
CREATE POLICY "Staff and invitees can read invites" ON public.user_invites
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR invited_by = (auth.jwt()->>'sub')
    OR lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
  );

-- Users may only accept an invite matching their JWT email claim
CREATE POLICY "Users can accept own email invite" ON public.user_invites
  FOR UPDATE TO authenticated
  USING (
    lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
    AND status = 'pending'
  )
  WITH CHECK (
    lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
    AND status = 'accepted'
  );

-- Fallback accept RPC when email claim is missing from JWT template
CREATE OR REPLACE FUNCTION public.accept_invite(p_invite_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT := auth.jwt()->>'sub';
  v_email TEXT := lower(COALESCE(auth.jwt()->>'email', ''));
  v_invite_email TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(email) INTO v_invite_email
  FROM public.user_invites
  WHERE id = p_invite_id AND status = 'pending';

  IF v_invite_email IS NULL THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'P0002';
  END IF;

  -- Prefer email match; if JWT has no email, allow accept only when caller
  -- profile email matches the invite (post-signup provisioning).
  IF v_email = '' THEN
    SELECT lower(email) INTO v_email FROM public.profiles WHERE id = v_caller;
  END IF;

  IF v_email IS NULL OR v_email <> v_invite_email THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invite(UUID) TO authenticated;

-- -------------------------------------------------------
-- 3. Drop debug RPC
-- -------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_jwt_sub();

-- -------------------------------------------------------
-- 4. Device push tokens
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, token)
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push tokens" ON public.device_push_tokens;
CREATE POLICY "Users manage own push tokens" ON public.device_push_tokens
  FOR ALL TO authenticated
  USING (user_id = (auth.jwt()->>'sub'))
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;

-- -------------------------------------------------------
-- 5. Contracts storage bucket
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  true,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can read contracts" ON storage.objects;
CREATE POLICY "Authenticated users can read contracts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contracts');

DROP POLICY IF EXISTS "Staff can upload contracts" ON storage.objects;
CREATE POLICY "Staff can upload contracts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR (SELECT private.is_landlord())
    )
  );

DROP POLICY IF EXISTS "Staff can update contracts" ON storage.objects;
CREATE POLICY "Staff can update contracts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR (SELECT private.is_landlord())
    )
  )
  WITH CHECK (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR (SELECT private.is_landlord())
    )
  );

DROP POLICY IF EXISTS "Staff can delete contracts" ON storage.objects;
CREATE POLICY "Staff can delete contracts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (
      (SELECT private.is_admin())
      OR (SELECT private.is_landlord())
    )
  );

-- -------------------------------------------------------
-- 6. Low-stock threshold from system_settings
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.apply_inventory_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_qty INTEGER;
  threshold INTEGER := 5;
BEGIN
  BEGIN
    SELECT GREATEST(0, COALESCE(value::integer, 5))
      INTO threshold
    FROM public.system_settings
    WHERE key = 'low_stock_threshold';
  EXCEPTION WHEN OTHERS THEN
    threshold := 5;
  END;

  UPDATE public.inventory
  SET quantity = GREATEST(0, quantity - NEW.quantity_used),
      updated_at = timezone('utc'::text, now())
  WHERE id = NEW.inventory_id
  RETURNING quantity INTO new_qty;

  IF new_qty IS NOT NULL THEN
    UPDATE public.inventory
    SET status = CASE
      WHEN new_qty = 0 THEN 'out_of_stock'
      WHEN new_qty <= threshold THEN 'low_stock'
      ELSE 'in_stock'
    END
    WHERE id = NEW.inventory_id;
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------
-- 7. Scheduled rent_due / lease_expiry notifications
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_scheduled_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rent_count INTEGER := 0;
  expiry_count INTEGER := 0;
  today DATE := (timezone('utc', now()))::date;
  lease_rec RECORD;
BEGIN
  -- Rent due: active leases whose start_date day-of-month matches today
  -- (or last day of month when lease started on a later day). Skip if a
  -- rent_due notification was already sent for this lease today.
  FOR lease_rec IN
    SELECT l.id, l.tenant_id, l.rent_amount, l.start_date, l.end_date, p.title
    FROM public.leases l
    JOIN public.properties p ON p.id = l.property_id
    WHERE l.status = 'active'
      AND l.end_date >= today
      AND (
        EXTRACT(DAY FROM l.start_date)::int = EXTRACT(DAY FROM today)::int
        OR (
          EXTRACT(DAY FROM l.start_date)::int > EXTRACT(DAY FROM (date_trunc('month', today) + interval '1 month - 1 day'))::int
          AND EXTRACT(DAY FROM today)::int = EXTRACT(DAY FROM (date_trunc('month', today) + interval '1 month - 1 day'))::int
        )
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = lease_rec.tenant_id
        AND n.type = 'rent_due'
        AND n.entity_id = lease_rec.id::text
        AND n.created_at::date = today
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (
        lease_rec.tenant_id,
        'rent_due',
        'Rent Due',
        format('Rent of KES %s for %s is due.', to_char(lease_rec.rent_amount, 'FM999,999,999'), lease_rec.title),
        'lease',
        lease_rec.id::text
      );
      rent_count := rent_count + 1;
    END IF;
  END LOOP;

  -- Lease expiry: active leases ending within 30 days
  FOR lease_rec IN
    SELECT l.id, l.tenant_id, l.end_date, p.title, l.owner_id
    FROM public.leases l
    JOIN public.properties p ON p.id = l.property_id
    WHERE l.status = 'active'
      AND l.end_date BETWEEN today AND (today + 30)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = lease_rec.tenant_id
        AND n.type = 'lease_expiry'
        AND n.entity_id = lease_rec.id::text
        AND n.created_at::date = today
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (
        lease_rec.tenant_id,
        'lease_expiry',
        'Lease Ending Soon',
        format('Your lease for %s ends on %s.', lease_rec.title, lease_rec.end_date::text),
        'lease',
        lease_rec.id::text
      );
      expiry_count := expiry_count + 1;
    END IF;

    -- Also notify landlord/owner when present
    IF lease_rec.owner_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = lease_rec.owner_id
        AND n.type = 'lease_expiry'
        AND n.entity_id = lease_rec.id::text
        AND n.created_at::date = today
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
      VALUES (
        lease_rec.owner_id,
        'lease_expiry',
        'Tenant Lease Ending Soon',
        format('Lease for %s ends on %s.', lease_rec.title, lease_rec.end_date::text),
        'lease',
        lease_rec.id::text
      );
      expiry_count := expiry_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rent_due', rent_count, 'lease_expiry', expiry_count);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_scheduled_alerts() TO service_role;

-- Optional pg_cron schedule when extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('ibse-scheduled-alerts');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'ibse-scheduled-alerts',
      '0 6 * * *',
      $cron$ SELECT public.run_scheduled_alerts(); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$$;
