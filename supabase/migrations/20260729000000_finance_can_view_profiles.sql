-- Finance officers verify payments and need payer name/email embeds.
-- Profile SELECT was admin-only, so finance dashboards showed blank payers.
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins and Finance can view all profiles" ON public.profiles;

CREATE POLICY "Admins and Finance can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin_or_finance()));
