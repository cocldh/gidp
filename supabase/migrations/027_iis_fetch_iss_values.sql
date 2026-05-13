-- IIS generate route needs to resolve ISS-sourced columns (e.g. SA-2799 INLET
-- SIZE, ORIFICE AREA, SET PRESSURE) by joining iss.document → iss.document_value
-- per tag. Stub before this migration just emitted blank cells.
--
-- Returns jsonb_agg of {tag_number, field_id, value_text} so PostgREST cannot
-- range-truncate the result (same pattern as 025).
--
-- Lookup is keyed by tag_number rather than tag_id because the IIS RPCs
-- (iis_fetch_all_tags_jsonb, iis_fetch_tags_page, iis_fetch_tags_by_function_keys)
-- only project record_id + tag_number from idx.index_record. tag_number is the
-- canonical join key into public.tag and from there into iss.document.

CREATE OR REPLACE FUNCTION drawings.iis_fetch_iss_values(
  p_project_id   int,
  p_field_ids    int[],
  p_tag_numbers  text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, iss, drawings, pg_temp
SET statement_timeout = '120s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'iss', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: iss Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF p_field_ids IS NULL OR cardinality(p_field_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tag_number', t.tag_number,
    'field_id',   dv.field_id,
    'value_text', dv.value_text
  )), '[]'::jsonb)
  INTO v_result
  FROM iss.document d
  JOIN public.tag t          ON t.tag_id = d.tag_id
  JOIN iss.document_value dv ON dv.document_id = d.document_id
  WHERE d.project_id = p_project_id
    AND d.tag_id IS NOT NULL
    AND dv.field_id = ANY(p_field_ids)
    AND (
      p_tag_numbers IS NULL
      OR cardinality(p_tag_numbers) = 0
      OR t.tag_number = ANY(p_tag_numbers)
    );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_fetch_iss_values(int, int[], text[]) TO authenticated;
