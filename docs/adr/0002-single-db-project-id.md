# ADR 0002 — Schema-per-project 폐기, 통합 + project_id + RLS

**Status**: Accepted (2026-04)

## Context

기존 ISS(iss-web)는 프로젝트마다 별도 PG schema를 쓰는 구조였다 (`proj_alpha.tag`, `proj_beta.tag`, …). 쿠키 `iss_project`로 Supabase PostgREST의 `Accept-Profile` 헤더를 바꿔 schema를 전환하는 방식.

GIDP는 ISS·Index·Drawings 세 모듈이 서로의 데이터를 참조해야 한다 — 예: 한 Loop에 속한 tag들 + 그 tag의 ISS document + 연결된 Cable/JB. per-project schema에서는:
- Cross-module FK가 schema 이름을 하드코드해야 함 (`iss.document.tag_id REFERENCES proj_alpha.tag`) → 프로젝트 추가마다 schema 교체·마이그레이션 재실행
- `search_path` 조작이 PostgREST와 충돌 (Supabase 클라이언트는 명시적 `.schema()` 호출 필요, cross-schema 조인이 어색)
- RLS가 schema 단위로만 가능 — "프로젝트별 접근 제어"가 schema 존재 자체로 새는 위험

## Decision

**Schema-per-project 폐기**. 모듈 단위 schema(`public`, `iss`, `idx`, `drawings`) + 모든 테이블에 `project_id BIGINT NOT NULL` 컬럼 + RLS policy.

- `public.tag.project_id` → `public.project(project_id)` FK
- `iss.document.project_id` + `iss.document.tag_id` → `public.tag(tag_id)` FK
- RLS는 `user_project_role` / `user_project_module`을 조회해서 `project_id` 일치 여부 + access level 확인

사용자는 shell의 `/project` 화면에서 프로젝트를 선택하고, 그 선택은 `gidp_project_id` 쿠키에 담김. 서버 쿼리는 `.eq('project_id', projectId)`로 scoping.

## Consequences

**Good**
- Cross-module 쿼리가 자연스러움. `iss.document JOIN public.tag ON iss.document.tag_id = public.tag.tag_id WHERE tag.project_id = X` 한 줄.
- 프로젝트 추가는 `INSERT INTO public.project`만 — DDL 없음.
- RLS가 row-level로 정교. 프로젝트 경계 우회가 DB 레벨에서 차단됨.
- PostgREST `Accept-Profile`을 module schema 단위로만 사용 — Supabase 클라이언트 패턴이 단순.

**Bad / 주의사항**
- 단일 테이블에 모든 프로젝트 데이터가 섞임 — 대용량 프로젝트가 들어오면 인덱스·파티셔닝 전략을 Phase 4 이후 고려해야 함.
- RLS policy가 `user_project_role`에 의존 — 이 테이블 성능이 핫스팟. 필요시 materialized view 또는 JWT claim에 role 캐싱.
- 기존 ISS 데이터 이관 시 schema 변환 필요 — `scripts/snapshot-iss-to-gidp.ts`가 per-project schema 순회하며 `project_id` 부여해서 단일 테이블로 병합.
- Supabase Dashboard에서 `idx`, `iss`, `drawings` schema를 "Exposed schemas"에 명시적으로 추가해야 PostgREST가 노출.

**Revisit 조건**: 단일 프로젝트가 RLS·인덱스 전략으로도 감당 안 되는 규모로 성장하면, 해당 프로젝트만 별도 Supabase로 분리하는 sharding을 검토.
