-- Account approval for public tenant/client self-signups.
-- Invited and admin/landlord-created accounts are auto-approved.
-- Existing profiles are backfilled as approved.

-- -------------------------------------------------------
-- 1. Column + backfill
-- -------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT;

UPDATE public.profiles
SET account_status = 'approved'
WHERE account_status IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN account_status SET DEFAULT 'pending',
  ALTER COLUMN account_status SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('pending', 'approved', 'rejected'));

-- -------------------------------------------------------
-- 2. Protect account_status from self-escalation
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION private.protect_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_jwt_role TEXT := COALESCE(auth.jwt()->>'role', '');
  v_has_invite BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role IN ('admin', 'finance', 'landlord') THEN
      NEW.account_status := 'approved';
    ELSIF v_jwt_role = 'service_role' THEN
      IF NEW.account_status IS NULL OR NEW.account_status = '' THEN
        NEW.account_status := 'approved';
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.user_invites
        WHERE lower(email) = lower(NEW.email)
          AND status = 'pending'
      ) INTO v_has_invite;

      IF v_has_invite THEN
        NEW.account_status := 'approved';
      ELSE
        -- Authenticated self-signup cannot self-approve.
        NEW.account_status := 'pending';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      IF current_setting('app.bypass_account_status', true) = 'on' THEN
        RETURN NEW;
      END IF;
      IF NOT private.is_admin() THEN
        RAISE EXCEPTION 'Only admins can change account status'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_account_status ON public.profiles;
CREATE TRIGGER trg_protect_account_status
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_account_status();

REVOKE ALL ON FUNCTION private.protect_account_status() FROM PUBLIC;

-- -------------------------------------------------------
-- 3. Invite acceptance also approves the profile
-- -------------------------------------------------------
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

  -- Approve the newly created profile (bypasses protect trigger).
  PERFORM set_config('app.bypass_account_status', 'on', true);
  UPDATE public.profiles
  SET account_status = 'approved'
  WHERE id = v_caller
    AND account_status IS DISTINCT FROM 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invite(UUID) TO authenticated;

-- -------------------------------------------------------
-- 4. Notification type for pending account signups
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
      'purchase_update',
      'account_approval'
    )
  );
