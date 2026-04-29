-- Migration 014: user_project_role → user_project_module 자동 동기화
--
-- user_project_role 에 ProjectAdmin/Editor/Viewer 를 부여하면
-- iss/idx/drawings 세 모듈에 동일 수준의 access 가 자동으로 반영된다.
-- 역할 삭제 시 세 모듈 행도 함께 삭제된다.

CREATE OR REPLACE FUNCTION public.sync_project_role_to_modules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_access TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.user_project_module
    WHERE user_id = OLD.user_id AND project_id = OLD.project_id;
    RETURN OLD;
  END IF;

  v_access := CASE NEW.role
    WHEN 'ProjectAdmin' THEN 'Admin'
    WHEN 'Editor'       THEN 'Editor'
    WHEN 'Viewer'       THEN 'Viewer'
    ELSE 'None'
  END;

  INSERT INTO public.user_project_module (user_id, project_id, module, access)
  VALUES
    (NEW.user_id, NEW.project_id, 'iss',      v_access),
    (NEW.user_id, NEW.project_id, 'idx',      v_access),
    (NEW.user_id, NEW.project_id, 'drawings', v_access)
  ON CONFLICT (user_id, project_id, module)
  DO UPDATE SET access = EXCLUDED.access, assigned_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_project_role_to_modules
AFTER INSERT OR UPDATE OR DELETE ON public.user_project_role
FOR EACH ROW EXECUTE FUNCTION public.sync_project_role_to_modules();

-- 기존 user_project_role 행 백필 (트리거 생성 전에 삽입된 데이터 보정)
INSERT INTO public.user_project_module (user_id, project_id, module, access)
SELECT
  upr.user_id,
  upr.project_id,
  m.module,
  CASE upr.role
    WHEN 'ProjectAdmin' THEN 'Admin'
    WHEN 'Editor'       THEN 'Editor'
    WHEN 'Viewer'       THEN 'Viewer'
    ELSE 'None'
  END AS access
FROM public.user_project_role upr
CROSS JOIN (VALUES ('iss'), ('idx'), ('drawings')) AS m(module)
ON CONFLICT (user_id, project_id, module)
DO UPDATE SET access = EXCLUDED.access, assigned_at = now();
