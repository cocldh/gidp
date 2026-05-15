-- tag_number 변경 시 기존 tag_id를 유지하도록 트리거 수정
-- source_record_id를 ON CONFLICT key로 쓰기 위해 unique constraint 추가
ALTER TABLE public.tag
  ADD CONSTRAINT tag_source_record_id_unique UNIQUE (source_record_id);

-- source_record_id 기준으로 기존 row를 찾아 UPDATE; 없을 때만 INSERT
CREATE OR REPLACE FUNCTION public.idx_record_sync_to_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tag_number TEXT;
  v_core RECORD;
  v_vals JSONB := '{}'::jsonb;
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

  -- source_record_id로 기존 row가 있으면 UPDATE (tag_id 유지, tag_number 포함 전체 갱신)
  -- 없으면 INSERT (신규 태그)
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
  ON CONFLICT (source_record_id) DO UPDATE SET
    tag_number          = EXCLUDED.tag_number,
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
    updated_at          = now();

  RETURN NEW;
END;
$$;
