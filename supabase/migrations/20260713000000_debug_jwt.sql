-- Temporary diagnostic function to expose auth.jwt()->>'sub' to the client.
-- Remove after debugging is complete.
CREATE OR REPLACE FUNCTION public.get_jwt_sub()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.jwt()->>'sub';
$$;

GRANT EXECUTE ON FUNCTION public.get_jwt_sub() TO authenticated;
