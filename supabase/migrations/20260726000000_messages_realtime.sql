-- Expose lease messages to Supabase Realtime so clients can subscribe
-- to new inserts without polling / remounting.
-- Idempotent: table may already be in the publication from a prior apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
