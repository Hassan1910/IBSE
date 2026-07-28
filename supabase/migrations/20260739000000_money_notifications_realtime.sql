-- Expose money + notification tables to Supabase Realtime so tenants
-- can refresh dashboards when an admin verifies a payment.
-- Idempotent: tables may already be in the publication from a prior apply.
-- REPLICA IDENTITY FULL is required for UPDATE filters on non-PK columns
-- (payer_id, client_id, tenant_id).

ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.deposit_payments REPLICA IDENTITY FULL;
ALTER TABLE public.leases REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payments',
    'deposit_payments',
    'leases',
    'notifications'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
