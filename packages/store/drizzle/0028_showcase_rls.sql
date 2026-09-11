-- Scoped defence in depth for private showcase bytes. Production tables untouched.
ALTER TABLE public.showcase_footage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_footage FORCE ROW LEVEL SECURITY;
CREATE POLICY showcase_operator_rows ON public.showcase_footage TO playerone_app
  USING (operator_id::text = nullif(current_setting('app.showcase_operator_id', true), '') AND expires_at > now())
  WITH CHECK (operator_id::text = nullif(current_setting('app.showcase_operator_id', true), '') AND expires_at > now());
-- The trusted migration/table owner remains the fixed-purpose maintenance owner.
-- Runtime roles receive neither ownership nor membership in this role.
DO $$ DECLARE owner_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='public.showcase_footage'::regclass;
  IF owner_name IN ('playerone_app','playerone_risk') THEN RAISE EXCEPTION 'Showcase requires a separate trusted table owner'; END IF;
  EXECUTE format('CREATE POLICY showcase_trusted_owner ON public.showcase_footage TO %I USING (true) WITH CHECK (true)', owner_name);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.showcase_footage_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(734091026);
  DELETE FROM public.showcase_footage WHERE expires_at <= now();
  IF (SELECT count(*) FROM public.showcase_footage WHERE operator_id = NEW.operator_id) >= 5 THEN
    RAISE EXCEPTION 'showcase operator quota reached' USING ERRCODE='23514', CONSTRAINT='showcase_owner_quota';
  END IF;
  IF (SELECT coalesce(sum(bytes),0) FROM public.showcase_footage)+NEW.bytes > 209715200 THEN
    RAISE EXCEPTION 'showcase storage quota reached' USING ERRCODE='23514', CONSTRAINT='showcase_storage_quota';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.showcase_footage_quota() FROM PUBLIC;
CREATE FUNCTION public.showcase_purge_expired() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.showcase_footage WHERE expires_at <= now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.showcase_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.showcase_purge_expired() TO playerone_app;
