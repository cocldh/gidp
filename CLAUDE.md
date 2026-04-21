# CLAUDE.md — GIDP 작업 가이드

Claude 세션이 시작할 때 자동으로 로드되는 프로젝트 진입점. 코드에서 자명한 것(파일 구조, import 경로)은 여기에 쓰지 않고, **자명하지 않은 아키텍처 결정·컨벤션·제약**에 집중합니다.

## Index

1. [프로젝트 한 줄 요약](#프로젝트-한-줄-요약)
2. [Monorepo 맵 (pnpm + Turborepo)](#monorepo-맵-pnpm--turborepo)
3. [로컬 개발 환경 — 포트와 URL](#로컬-개발-환경--포트와-url)
4. [Multi-Zones 아키텍처 — 필수 규칙](#multi-zones-아키텍처--필수-규칙)
5. [필수 컨벤션](#필수-컨벤션)
6. [Supabase 구성](#supabase-구성)
7. [작업 플로우](#작업-플로우)
8. [문서 맵](#문서-맵)

---

## 프로젝트 한 줄 요약

EPC 계장 데이터 라이프사이클 통합 플랫폼 — Master Index → Spec Sheet → 도면 자동생성. **기존 `../ISS`·`../Index` 앱과 Supabase는 Phase 6 Cutover 전까지 read-write 그대로 유지**, GIDP는 별도 Supabase·도메인에서 병행 운영.

## Monorepo 맵 (pnpm + Turborepo)

| 위치 | 역할 | 포트 | basePath |
|---|---|---|---|
| `apps/shell` | GIDP 허브 — 로그인·프로젝트 선택·대시보드·admin 진입점 | 3000 | (없음, 호스트) |
| `apps/iss` | Instrument Specification Sheet | 3001 | `/iss` |
| `apps/index` | Master Instrument Index (AG Grid) | 3002 | `/index` |
| `apps/drawings` | Wiring/Loop/Hook-up UI (Phase 3 신규) | 3003 | `/drawings` |
| `services/drawing-gen` | Python FastAPI (ezdxf + reportlab) — Phase 3 | 8000 | — |
| `packages/auth` | Supabase SSR client + `createAuthMiddleware` + RBAC | — | — |
| `packages/ui` | 공통 React 컴포넌트 (Navbar, RoleGuard, TagList) | — | — |
| `packages/domain` | zod 스키마 — Project/Tag/Loop/Cable/JB/Terminal | — | — |
| `packages/db` | Supabase 생성 타입 + 쿼리 헬퍼 | — | — |
| `packages/config` | tsconfig/eslint/tailwind 공용 preset | — | — |
| `supabase/migrations/` | 단일 통합 스키마 SSOT | — | — |
| `scripts/` | 기존 Supabase → GIDP 스냅샷 복제 (단방향 read-only) | — | — |
| `legacy/` | 미이관 자산 (tkinter GUI 등) read-only archive | — | — |

## 로컬 개발 환경 — 포트와 URL

기본 진입점은 **`http://localhost:3000`** (shell). 모든 툴 앱 접근은 shell을 경유합니다. `localhost:3001/iss/...` 직접 접근은 dev에서만 동작하고 일부 경로(예: `/login`)는 shell 전용이므로 404가 날 수 있습니다.

`pnpm dev` 한 번으로 shell/iss/index를 동시 기동. 포트 충돌 시 `netstat -ano | grep ":300"`로 남은 node 프로세스 확인.

## Multi-Zones 아키텍처 — 필수 규칙

사용자는 하나의 origin(`gidp.com` / dev에선 `localhost:3000`)만 봅니다. shell의 `next.config.ts`가 `/iss/*` → iss zone, `/index/*` → index zone, `/drawings/*` → drawings zone으로 **rewrite**합니다. 각 zone 앱은 자체 `basePath`를 가집니다.

### 링크·redirect 작성 규칙 (자주 틀림)

**같은 zone 내부 네비게이션** → `next/link`의 `<Link href="/dashboard">` — Next.js가 basePath(`/iss`)를 자동 prepend해서 `/iss/dashboard`가 됨.

**zone에서 shell로 나가는 링크** (`← GIDP`, signout, 프로젝트 전환 등) → raw `<a href="/">` 또는 `window.location.assign('/login')` — basePath가 prepend되지 않아 origin 루트의 shell 경로로 감.

**서버 컴포넌트 redirect** (예: iss `/dashboard/page.tsx`에서 Pending 체크 후) → `redirect('/login')` — origin-relative이므로 basePath 영향 없음.

### 미들웨어 redirect

`packages/auth/src/middleware.ts`의 `createAuthMiddleware()`는 `NextResponse.redirect(new URL(path, request.nextUrl))`로 redirect. `request.nextUrl`을 base로 써서 **같은 origin 기준 path 직렬화**가 보장됨. 절대 경로 문자열을 raw `NextResponse`의 Location에 직접 넣으면 Next.js 내부 `parseURL`에서 `Invalid URL`로 500 터짐(`/login?return_to=/` 같은 값 때문). 반드시 `new URL(...)` 경유.

### return_to 검증

로그인·프로젝트 선택 화면은 `return_to` 파라미터를 받습니다. `isSafeReturnUrl()` (shell의 `login/page.tsx`, `project/actions.ts`)은:
- path-only (`/`로 시작, `//`·`/\` 제외) → 수용
- 절대 URL은 localhost 또는 `NEXT_PUBLIC_ALLOWED_RETURN_HOSTS` allow-list만 수용

open redirect 방지 목적.

### 자산 서빙

각 zone의 `_next/static` 자산은 그 zone origin에서 서빙됩니다. shell의 `zoneRewrites()` 헬퍼가 `prefix/:path*` 매칭으로 `_next` 요청까지 forward. zone은 `assetPrefix`로 zone의 public URL을 설정 가능.

## 필수 컨벤션

### DB 스키마

**Schema 분리 패턴**: 모듈별 PG schema + 모든 테이블에 `project_id` 컬럼 + RLS. (ISS 기존 per-project schema는 **폐기**. 이유는 `docs/adr/0002-single-db-project-id.md` 참조.)

| schema | 용도 |
|---|---|
| `public` | user/project/tag/loop 마스터 (cross-cutting) |
| `iss` | document/template/mapping_rule/revision |
| `idx` | index_record/index_column/index_audit |
| `drawings` | junction_box/cable/terminal/drawing_instance |

PostgREST 노출이 필요한 schema는 Supabase Dashboard > Settings > API > Exposed schemas에 `idx, iss, drawings` 추가.

### Project code 포맷

`public.project.project_code`는 `^[ep]\d{6}$` — 단일 문자(`e` execution / `p` proposal) + 숫자 6자리. 예: `e230350`, `p230351`.

- DB: CHECK 제약 `project_code_format_chk` (migration 010)
- zod: `PROJECT_CODE_REGEX`·`projectCodeSchema` (`packages/domain/src/public.ts`)
- UI: `apps/iss/src/app/admin/projects/page.tsx`의 입력 마스크

### Tag core field sync

Index에서 200+ 컬럼 중 `is_tag_core=true`인 컬럼만 `public.tag`로 sync. 트리거 `idx_record_sync_to_tag()` (migration 006). ISS/Drawings는 `public.tag`를 참조. 직접 `idx.index_record` 참조 금지.

플래그 지정은 DB row (`idx.index_column.is_tag_core` + `tag_core_field`) — 코드에 없음. FGIP2(project_id=2) 기준 현재 8개 매핑 (`ex_rating`/`ex_certification` 유보) — 근거는 `docs/adr/0006-is-tag-core-mapping.md`. 신규 프로젝트 시드 시 동일 리뷰 → `SELECT public.idx_backfill_tags(<project_id>)` 로 replay.

**Index-only 태그 (ISS 복제본에 없는 태그)** 는 `public.tag` 에 등록되지만 `iss.document` 없음 — 설계상 정상. ISS TagList/`/iss/dashboard/{tagId}` 에서 "No documents" 가 정상 동작 (spec sheet 대상이 아닌 태그). 버그로 취급 금지.

### 쿠키

| 이름 | 저장처 | 용도 |
|---|---|---|
| Supabase auth 쿠키들 (`sb-*`) | `@supabase/ssr` 관리 | 세션 |
| `gidp_project_id` | shell의 `selectProject` 서버 액션 | 현재 프로젝트 ID. 미들웨어가 체크해서 없으면 `/project`로 리다이렉트 |

localhost에서는 쿠키가 호스트명 기준으로 공유됨(포트 무시, RFC 6265) — dev에서 `localhost:3000`·`:3001`·`:3002`가 세션 공유함. 운영에서는 `NEXT_PUBLIC_COOKIE_DOMAIN`로 shared parent domain 설정.

### 인증 가드

| 레이어 | 책임 |
|---|---|
| shell `proxy.ts` 미들웨어 | 세션 필수, `/login`으로 리다이렉트 |
| 툴 zone `proxy.ts` 미들웨어 | 세션 + `gidp_project_id` 쿠키 필수 |
| shell `/` 대시보드 | `role=Pending`이면 `/pending`, 모듈 access 로드 |
| 툴 zone 서버 컴포넌트 | project-scoped 권한 체크 (`user_project_role`) |

## Supabase 구성

- GIDP 프로젝트 ID: `crtsgykvmowpxqfqchgy`
- 레거시 ISS Supabase: `lyqsabfezsmapbzdnlko` — e230350(FGIP2) schema 한 덩어리. Phase 6 전까지 별도 유지 (read-only 스냅샷만 수행)
- 레거시 Index Supabase: 동일 원칙 (단 Index 이관은 사용자 .xlsb 업로드로 대체 — 스냅샷 스크립트 없음)
- Migrations는 `supabase/migrations/` SSOT. 번호 순서대로 적용.
- Supabase MCP 툴(`mcp__claude_ai_Supabase__*`) 사용 가능 — `apply_migration`(DDL), `execute_sql`(DML·조회)

### 데이터 스냅샷 (레거시 → GIDP)

`scripts/snapshot-iss-to-gidp.ts` — 레거시 ISS(`e230350` schema) 전체를 GIDP 의 `public.tag` + `iss.*`(project_id=2 고정) 로 단방향 복제. 원본 연결을 `SET TRANSACTION READ ONLY` 로 강제하고, 모든 insert 를 `ON CONFLICT DO UPDATE` 로 멱등화. Source pk 유지 + 완료 시 sequence setval. 실행: `pnpm --filter @gidp/scripts snapshot:iss[:dry]`. 세부는 `scripts/README.md`.

## 작업 플로우

### 새 작업 시작 시

1. `PLAN.md` + `docs/adr/` 로 현재 Phase/결정 맥락 확인
2. 관련 파일을 읽고 변경. migration이 필요하면 번호 다음 파일로.
3. dev 서버가 이미 돌고 있으면 turbopack hot reload를 신뢰. 포트 충돌 에러가 나야 재기동.
4. UI 변경은 브라우저로 실제 확인. 서버 응답 확인만으론 부족.

### 커밋 전

- `pnpm type-check` — workspace 전체 타입
- `pnpm lint`
- 미들웨어·auth 변경 시: shell `/login` 200, 보호 경로 307·return_to 보존 확인

### 검증 패턴 (shell 로그인 smoke test)

```bash
for p in "/login" "/" "/project" "/iss" "/index"; do
  curl -s -D - -o /dev/null "http://localhost:3000$p" | head -3
done
```

## 문서 맵

| 파일 | 용도 |
|---|---|
| `README.md` | 신규 개발자 온보딩, dev 환경 설치 |
| `CLAUDE.md` (이 파일) | Claude·개발자 공용 작업 가이드. 컨벤션과 아키텍처 규칙 |
| `PLAN.md` | Phase 0~6 로드맵, 데이터 이관 계획, 미결정 사항 |
| `docs/architecture.md` | 고수준 시스템 아키텍처 (Multi-Zones, DB 모델, 인증 흐름) |
| `docs/adr/` | 주요 결정 기록 (Architecture Decision Records) |
| `apps/*/README.md` | 각 앱 고유 사항 (있는 경우) |
| `apps/index/AGENTS.md` | Next.js 16 breaking changes 경고 |
