# ADR 0003 — Project code 포맷 `^[ep]\d{6}$`

**Status**: Accepted (2026-04)

## Context

초기 GIDP 부트스트랩 프로젝트의 `project_code`는 `FGIP2-GIDP` 같은 임의 문자열이었다. 실무(GS Engineering EPC)에서는 모든 프로젝트에 규격화된 내부 코드가 할당된다:
- 첫 글자: 프로젝트 단계
  - `e` — execution (실행 단계, 수주 후)
  - `p` — proposal (제안 단계)
- 이후 6자리 숫자: 프로젝트 시퀀스 번호

예: `e230350` (2023년 일련번호 0350, 실행 단계 프로젝트).

이 규칙은 검색·분류·외부 시스템 연계에 직접 쓰이므로 GIDP의 `project.project_code`가 이를 따르도록 강제해야 한다.

## Decision

`public.project.project_code`에 정규식 `^[ep]\d{6}$` 강제. 세 층에서 검증:

1. **DB**: `CHECK (project_code ~ '^[ep][0-9]{6}$')` 제약 `project_code_format_chk` (migration 010)
2. **도메인 스키마**: `PROJECT_CODE_REGEX` + `projectCodeSchema` (zod) in `packages/domain/src/public.ts`. `ProjectSchema`가 사용.
3. **UI**: `apps/iss/src/app/admin/projects/page.tsx` 입력 마스크 — 첫 글자 `e|p`만 수용, 이후 숫자 6자리, `maxLength=7`. 제출 전 regex 검증.

서버 API(`apps/iss/src/app/api/admin/create-project/route.ts`)에서도 regex 검증 — 클라이언트 우회 방지.

기존 `FGIP2-GIDP` 레코드는 테스트베드용이므로 `e230350`·name `FGIP2`로 업데이트 (Supabase MCP `execute_sql`).

## Consequences

**Good**
- 실무 관행과 일치 — 사용자가 외부 시스템 코드를 그대로 입력.
- 3층 검증으로 잘못된 형식이 DB에 들어갈 경로 차단.
- 새 프로젝트 단계(예: `r` revamp)가 생기면 regex 한 곳 수정 + migration 추가로 확장 가능.

**Bad / 주의사항**
- 코드 자체는 연번이므로 충돌 방지는 GS 내부 코드 관리에 의존. UNIQUE 제약은 이미 있으므로 동일 코드 중복은 차단.
- 스냅샷 이관 시 기존 ISS Supabase의 임의 코드들이 이 포맷을 위반할 수 있음 — 이관 스크립트가 프로젝트별로 mapping table을 두고 새 코드를 부여하거나, 이관 시점에 사용자와 코드 확정 필요.

**Revisit 조건**: GS 내부 코드 체계가 바뀌면 새 ADR + 새 migration.
