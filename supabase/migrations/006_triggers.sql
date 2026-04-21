-- =============================================================================
-- 006_triggers.sql — updated_at, auth.users → user_profile, idx → public.tag sync
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Generic touch_updated_at trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tag_updated_at                  BEFORE UPDATE ON public.tag              FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_idx_record_updated_at           BEFORE UPDATE ON idx.index_record        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_jb_updated_at                   BEFORE UPDATE ON drawings.junction_box   FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cable_updated_at                BEFORE UPDATE ON drawings.cable          FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_drawing_instance_updated_at     BEFORE UPDATE ON drawings.drawing_instance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Auto-create user_profile on auth.users insert
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profile (id, email, display_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), 'Pending')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auth_user_to_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- idx.index_record.data JSONB → public.tag sync
-- -----------------------------------------------------------------------------
-- Reads idx.index_column.is_tag_core + tag_core_field to know which JSONB keys
-- map to which normalized public.tag columns. Upserts on (project_id, tag_number).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.idx_record_sync_to_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tag_number TEXT;
  v_core RECORD;
  v_tag_id BIGINT;
  v_vals JSONB := '{}'::jsonb;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- Clear source_record_id references; keep tag row (may be referenced elsewhere)
    UPDATE public.tag SET source_record_id = NULL WHERE source_record_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Collect is_tag_core mappings for this project
  FOR v_core IN
    SELECT column_name, tag_core_field
    FROM idx.index_column
    WHERE project_id = NEW.project_id AND is_tag_core = true
  LOOP
    v_vals := v_vals || jsonb_build_object(
      v_core.tag_core_field,
      NEW.data -> v_core.column_name
    );
  END LOOP;

  v_tag_number := NULLIF(trim(v_vals ->> 'tag_number'), '');
  IF v_tag_number IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.tag (
    project_id, tag_number, service_description, instrument_type, signal_type,
    io_type, loop_number, pnid_number, location, ex_rating, ex_certification,
    source_record_id
  )
  VALUES (
    NEW.project_id,
    v_tag_number,
    v_vals ->> 'service_description',
    v_vals ->> 'instrument_type',
    v_vals ->> 'signal_type',
    v_vals ->> 'io_type',
    v_vals ->> 'loop_number',
    v_vals ->> 'pnid_number',
    v_vals ->> 'location',
    v_vals ->> 'ex_rating',
    v_vals ->> 'ex_certification',
    NEW.id
  )
  ON CONFLICT (project_id, tag_number) DO UPDATE SET
    service_description = EXCLUDED.service_description,
    instrument_type     = EXCLUDED.instrument_type,
    signal_type         = EXCLUDED.signal_type,
    io_type             = EXCLUDED.io_type,
    loop_number         = EXCLUDED.loop_number,
    pnid_number         = EXCLUDED.pnid_number,
    location            = EXCLUDED.location,
    ex_rating           = EXCLUDED.ex_rating,
    ex_certification    = EXCLUDED.ex_certification,
    source_record_id    = EXCLUDED.source_record_id,
    updated_at          = now()
  RETURNING tag_id INTO v_tag_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_idx_record_sync_tag
  AFTER INSERT OR UPDATE OR DELETE ON idx.index_record
  FOR EACH ROW EXECUTE FUNCTION public.idx_record_sync_to_tag();

-- -----------------------------------------------------------------------------
-- Backfill helper — call manually after toggling is_tag_core on columns:
--   SELECT public.idx_backfill_tags(project_id);
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.idx_backfill_tags(p_project_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE idx.index_record SET updated_at = now()
  WHERE project_id = p_project_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMIT;
