-- =============================================================================
-- 001_public_master.sql — GIDP master/cross-cutting tables
-- =============================================================================
-- Schema design rationale:
--   ISS legacy 는 프로젝트별 postgres schema (proj_alpha.tag, proj_beta.tag) 를
--   사용했으나 PostgREST search_path 조작 이슈 + cross-module FK 불가로 폐기.
--   GIDP 는 모듈별 schema (public/iss/idx/drawings) + 모든 테이블에 project_id 컬럼
--   + RLS 정책 조합으로 통합.
-- =============================================================================

BEGIN;

-- Extensions required by later indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Project registry
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project (
  project_id   SERIAL PRIMARY KEY,
  project_code TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- User profile (mirrors auth.users; populated by handle_new_user trigger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profile (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'Pending'
               CHECK (role IN ('Pending', 'Active', 'Admin')),
  username     VARCHAR(50) UNIQUE,
  pw_hash      VARCHAR(128),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_profile_username ON public.user_profile(username);

-- -----------------------------------------------------------------------------
-- Per-project role (ISS legacy shape, unchanged)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_project_role (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  project_id  INTEGER     NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL CHECK (role IN ('ProjectAdmin', 'Editor', 'Viewer')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID        REFERENCES public.user_profile(id) ON DELETE SET NULL,
  UNIQUE (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_upr_user    ON public.user_project_role(user_id);
CREATE INDEX IF NOT EXISTS idx_upr_project ON public.user_project_role(project_id);

-- -----------------------------------------------------------------------------
-- Per-project module access (NEW: Viewer of ISS might be Editor of Drawings)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_project_module (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  project_id  INTEGER     NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  module      TEXT        NOT NULL CHECK (module IN ('iss', 'idx', 'drawings')),
  access      TEXT        NOT NULL CHECK (access IN ('None', 'Viewer', 'Editor', 'Admin')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id, module)
);
CREATE INDEX IF NOT EXISTS idx_upm_user    ON public.user_project_module(user_id);
CREATE INDEX IF NOT EXISTS idx_upm_project ON public.user_project_module(project_id);

-- -----------------------------------------------------------------------------
-- Tag master (normalized, synced from idx.index_record via trigger 006)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tag (
  tag_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  tag_number           TEXT    NOT NULL,
  service_description  TEXT,
  instrument_type      TEXT,
  signal_type          TEXT,
  io_type              TEXT,
  loop_number          TEXT,
  pnid_number          TEXT,
  location             TEXT,
  ex_rating            TEXT,
  ex_certification     TEXT,
  source_record_id     BIGINT,   -- FK to idx.index_record set later (schema order)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag_number)
);
CREATE INDEX IF NOT EXISTS idx_tag_project        ON public.tag(project_id);
CREATE INDEX IF NOT EXISTS idx_tag_loop_number    ON public.tag(project_id, loop_number) WHERE loop_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tag_tag_number_trgm ON public.tag USING gin (tag_number gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Loop master (referenced by drawings.drawing_instance later)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loop (
  loop_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES public.project(project_id) ON DELETE CASCADE,
  loop_number  TEXT    NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, loop_number)
);
CREATE INDEX IF NOT EXISTS idx_loop_project ON public.loop(project_id);

-- -----------------------------------------------------------------------------
-- PostgREST schema exposure (Supabase Dashboard > Settings > API 에서도 설정 필요)
-- ALTER ROLE authenticator SET pgrst.db_schemas = 'public,iss,idx,drawings';
-- -----------------------------------------------------------------------------

COMMIT;
