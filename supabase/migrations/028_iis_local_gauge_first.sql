-- IIS generation 시 Loop Number 가 없는 local gauge 류 태그를 맨 앞에 배치.
-- 기존 NULLS LAST 정렬로는 Loop 있는 태그가 먼저 오고 null 이 뒤로 갔는데,
-- 사용자 요청대로 뒤집어서 local gauge → loop 순서로 stamping 되도록 한다.
-- 영향 RPC 4 개 (iis_fetch_tags_page / iis_fetch_all_tags / iis_fetch_all_tags_jsonb
-- / iis_fetch_tags_by_function_keys) 모두 동일 ORDER BY 사용.

-- 1) iis_fetch_tags_page (single 모드)
CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_page(
  p_project_id      int,
  p_loop_mid_letter text DEFAULT NULL,
  p_columns         text[] DEFAULT NULL,
  p_limit           int DEFAULT 100,
  p_offset          int DEFAULT 0
)
RETURNS TABLE (
  record_id           bigint,
  tag_number          text,
  loop_number         text,
  loop_internal_order text,
  data                jsonb,
  total_count         bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.data->>'1_TAG NUMBER',
    r.data->>'5_LOOP NUMBER',
    r.data->>'11_INTERNAL LOOP ORDER',
    CASE
      WHEN p_columns IS NULL THEN r.data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(k, r.data->k)
           FROM unnest(p_columns) AS k
          WHERE r.data ? k),
        '{}'::jsonb
      )
    END,
    count(*) OVER ()
  FROM idx.index_record r
  WHERE r.project_id = p_project_id
    AND r.is_committed = true
    AND (r.data->>'1_TAG NUMBER') IS NOT NULL
    AND (
      p_loop_mid_letter IS NULL
      OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
    )
  ORDER BY
    NULLIF(r.data->>'5_LOOP NUMBER', '') NULLS FIRST,
    NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
    r.data->>'1_TAG NUMBER'
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 2) iis_fetch_all_tags (legacy, 현재 라우트에서 사용 안 함 — 정합성 유지 차원)
CREATE OR REPLACE FUNCTION drawings.iis_fetch_all_tags(
  p_project_id      int,
  p_loop_mid_letter text   DEFAULT NULL,
  p_columns         text[] DEFAULT NULL
)
RETURNS TABLE (
  record_id           bigint,
  tag_number          text,
  loop_number         text,
  loop_internal_order text,
  data                jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
SET statement_timeout = '180s'
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.data->>'1_TAG NUMBER',
    r.data->>'5_LOOP NUMBER',
    r.data->>'11_INTERNAL LOOP ORDER',
    CASE
      WHEN p_columns IS NULL THEN r.data
      ELSE COALESCE(
        (SELECT jsonb_object_agg(k, r.data->k)
           FROM unnest(p_columns) AS k
          WHERE r.data ? k),
        '{}'::jsonb
      )
    END
  FROM idx.index_record r
  WHERE r.project_id = p_project_id
    AND r.is_committed = true
    AND (r.data->>'1_TAG NUMBER') IS NOT NULL
    AND (
      p_loop_mid_letter IS NULL
      OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
    )
  ORDER BY
    NULLIF(r.data->>'5_LOOP NUMBER', '') NULLS FIRST,
    NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
    r.data->>'1_TAG NUMBER';
END;
$$;

-- 3) iis_fetch_all_tags_jsonb (auto 모드)
CREATE OR REPLACE FUNCTION drawings.iis_fetch_all_tags_jsonb(
  p_project_id      int,
  p_loop_mid_letter text   DEFAULT NULL,
  p_columns         text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
SET statement_timeout = '180s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY ord), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY
          NULLIF(r.data->>'5_LOOP NUMBER', '') NULLS FIRST,
          NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
          r.data->>'1_TAG NUMBER'
      ) AS ord,
      jsonb_build_object(
        'record_id',           r.id,
        'tag_number',          r.data->>'1_TAG NUMBER',
        'loop_number',         r.data->>'5_LOOP NUMBER',
        'loop_internal_order', r.data->>'11_INTERNAL LOOP ORDER',
        'data',
          CASE
            WHEN p_columns IS NULL THEN r.data
            ELSE COALESCE(
              (SELECT jsonb_object_agg(k, r.data->k)
                 FROM unnest(p_columns) AS k
                WHERE r.data ? k),
              '{}'::jsonb
            )
          END
      ) AS row_obj
    FROM idx.index_record r
    WHERE r.project_id = p_project_id
      AND r.is_committed = true
      AND (r.data->>'1_TAG NUMBER') IS NOT NULL
      AND (
        p_loop_mid_letter IS NULL
        OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
      )
  ) sub;

  RETURN v_result;
END;
$$;

-- 4) iis_fetch_tags_by_function_keys (all 모드)
CREATE OR REPLACE FUNCTION drawings.iis_fetch_tags_by_function_keys(
  p_project_id      int,
  p_function_keys   text[],
  p_loop_mid_letter text   DEFAULT NULL,
  p_columns         text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, idx, drawings, pg_temp
SET statement_timeout = '180s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(p_project_id, 'idx', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: idx Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY ord), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY
          NULLIF(r.data->>'5_LOOP NUMBER', '') NULLS FIRST,
          NULLIF(r.data->>'11_INTERNAL LOOP ORDER', '')::int NULLS LAST,
          r.data->>'1_TAG NUMBER'
      ) AS ord,
      jsonb_build_object(
        'record_id',           r.id,
        'tag_number',          r.data->>'1_TAG NUMBER',
        'loop_number',         r.data->>'5_LOOP NUMBER',
        'loop_internal_order', r.data->>'11_INTERNAL LOOP ORDER',
        'data',
          CASE
            WHEN p_columns IS NULL THEN r.data
            ELSE COALESCE(
              (SELECT jsonb_object_agg(k, r.data->k)
                 FROM unnest(p_columns) AS k
                WHERE r.data ? k),
              '{}'::jsonb
            )
          END
      ) AS row_obj
    FROM idx.index_record r
    WHERE r.project_id = p_project_id
      AND r.is_committed = true
      AND (r.data->>'1_TAG NUMBER') IS NOT NULL
      AND (
        p_loop_mid_letter IS NULL
        OR split_part(r.data->>'5_LOOP NUMBER', '-', 3) = p_loop_mid_letter
      )
      AND (
        p_function_keys IS NULL
        OR cardinality(p_function_keys) = 0
        OR drawings.tag_function_key(r.data->>'1_TAG NUMBER') = ANY (p_function_keys)
      )
  ) sub;

  RETURN v_result;
END;
$$;
