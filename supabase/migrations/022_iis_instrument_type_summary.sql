-- Summary RPC for the IIS classification editor: returns each distinct
-- instrument_type in a project along with how many tags carry it.
-- The editor shows this list alongside the classification rules so the user
-- can see which template each type would route to before saving.
--
-- SECURITY DEFINER to avoid per-row RLS on public.tag (~30K rows in
-- FGIP2 project_id=2). A single has_module_access check up front replaces
-- the predicate evaluation. Mirrors the pattern in 019_iis_page_security_definer.sql.

CREATE OR REPLACE FUNCTION drawings.iis_instrument_type_summary(p_project_id int)
RETURNS TABLE (instrument_type text, n bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, drawings, pg_temp
AS $$
BEGIN
  IF NOT public.has_module_access(p_project_id, 'drawings', 'Viewer') THEN
    RAISE EXCEPTION 'access denied: drawings Viewer required for project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.instrument_type,
    COUNT(*)::bigint AS n
  FROM public.tag t
  WHERE t.project_id = p_project_id
    AND t.instrument_type IS NOT NULL
  GROUP BY t.instrument_type
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION drawings.iis_instrument_type_summary(int) TO authenticated;
