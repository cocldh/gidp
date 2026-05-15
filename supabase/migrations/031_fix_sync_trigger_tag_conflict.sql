-- 031_fix_sync_trigger_tag_conflict.sql
-- INSERT 시 source_record_id 충돌 없어도 (project_id, tag_number) 충돌이 발생하는 버그 수정.
-- SELECT → UPDATE/INSERT 방식으로 전환해 두 unique constraint 모두 안전하게 처리.

CREATE OR REPLACE FUNCTION public.idx_record_sync_to_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tag_number TEXT;
  v_core       RECORD;
  v_vals       JSONB := '{}'::jsonb;
  v_tag_id     BIGINT;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    UPDATE public.tag SET source_record_id = NULL WHERE source_record_id = OLD.id;
    RETURN OLD;
  END IF;

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

  -- 1순위: source_record_id로 기존 row 탐색 (tag_number 변경 케이스)
  SELECT tag_id INTO v_tag_id FROM public.tag WHERE source_record_id = NEW.id;

  -- 2순위: (project_id, tag_number)로 탐색 (ISS 데이터 또는 이전 업로드 잔존 row)
  IF v_tag_id IS NULL THEN
    SELECT tag_id INTO v_tag_id
    FROM public.tag
    WHERE project_id = NEW.project_id AND tag_number = v_tag_number;
  END IF;

  IF v_tag_id IS NOT NULL THEN
    UPDATE public.tag SET
      tag_number          = v_tag_number,
      service_description = v_vals ->> 'service_description',
      instrument_type     = v_vals ->> 'instrument_type',
      signal_type         = v_vals ->> 'signal_type',
      io_type             = v_vals ->> 'io_type',
      loop_number         = v_vals ->> 'loop_number',
      pnid_number         = v_vals ->> 'pnid_number',
      location            = v_vals ->> 'location',
      ex_rating           = v_vals ->> 'ex_rating',
      ex_certification    = v_vals ->> 'ex_certification',
      source_record_id    = NEW.id,
      updated_at          = now()
    WHERE tag_id = v_tag_id;
  ELSE
    INSERT INTO public.tag (
      project_id, tag_number, service_description, instrument_type, signal_type,
      io_type, loop_number, pnid_number, location, ex_rating, ex_certification,
      source_record_id
    ) VALUES (
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
    );
  END IF;

  RETURN NEW;
END;
$$;
