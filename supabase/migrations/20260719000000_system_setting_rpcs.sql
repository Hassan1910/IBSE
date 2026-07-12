-- Public-safe helpers for pre-auth signup checks and settings reads.
-- Authenticated clients can still SELECT system_settings / user_invites via RLS;
-- these RPCs let anon callers read only what signup/maintenance need.

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
