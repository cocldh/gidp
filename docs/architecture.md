# GIDP Architecture

GIDP의 전체 아키텍처를 한 곳에 모은 문서. 세부 결정의 **"왜"**는 `adr/`의 개별 ADR을 참조.

## Index

1. [시스템 토폴로지](#시스템-토폴로지)
2. [요청 흐름 — Multi-Zones](#요청-흐름--multi-zones)
3. [인증·세션·RBAC](#인증세션rbac)
4. [DB 모델](#db-모델)
5. [Tag Master 동기화](#tag-master-동기화)
6. [Drawings 파이프라인 (Phase 3)](#drawings-파이프라인-phase-3)
7. [데이터 이관 전략](#데이터-이관-전략)

---

## 시스템 토폴로지

```
                    ┌─────────────────────────────┐
                    │  Browser (single origin)    │
                    │  gidp.com  /  localhost:3000│
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  apps/shell (Next.js)       │
                    │  - /login, /project, /      │
                    │  - rewrites /iss, /index,   │
                    │    /drawings to zones       │
                    │  - middleware: session gate │
                    └──────┬──────┬──────┬────────┘
                           │      │      │
              rewrite /iss │      │      │ rewrite /drawings
                           │      │      │
              ┌────────────▼┐ ┌───▼───┐ ┌▼────────────┐
              │ apps/iss    │ │ apps/ │ │ apps/       │
              │ basePath    │ │ index │ │ drawings    │
              │  /iss       │ │ /index│ │  /drawings  │
              └─────────────┘ └───────┘ └──────┬──────┘
                                               │
                                     POST generate
                                               │
                                      ┌────────▼───────┐
                                      │ drawing-gen    │
                                      │ FastAPI+ezdxf  │
                                      │ (Phase 3)      │
                                      └────────┬───────┘
                                               │
                           ┌───────────────────▼────────────────────┐
                           │       Supabase (GIDP, Postgres)        │
                           │  public | iss | idx | drawings schemas │
                           │  RLS on project_id                     │
                           │  Storage: drawings/                    │
                           └────────────────────────────────────────┘
```

## 요청 흐름 — Multi-Zones

1. 사용자 브라우저 요청 `gidp.com/iss/dashboard`
2. shell이 받음 → `proxy.ts` 미들웨어 실행 (세션·프로젝트 쿠키 체크, 필요시 307)
3. 미들웨어 통과 후 `next.config.ts`의 `rewrites()`가 매칭. `zoneRewrites('/iss', ISS_ZONE)`이 생성한 `/iss/:path*` → `${ISS_ZONE}/iss/:path*`로 forward
4. iss zone에 요청 도착. basePath `/iss`와 매치되어 `app/dashboard/page.tsx` 렌더
5. iss zone 자체 미들웨어도 실행 (이중 가드) — 쿠키는 same-origin이라 공유됨
6. 응답이 shell을 거쳐 브라우저로

**왜 rewrite(reverse proxy)이지 redirect가 아닌가**: redirect는 브라우저가 URL을 바꾸고 zone origin이 노출됨. rewrite는 서버측 forward라 URL이 `gidp.com/iss/...`로 유지. 자산(`_next/static`)도 같은 경로로 zone에서 서빙됨.

**왜 zone마다 basePath**: 자기 경로(`/iss`)를 안다는 것 — 모든 내부 링크·자산 URL에 자동 prefix 붙음. basePath 없이 배포하면 `/dashboard` 같은 링크가 shell의 `/dashboard`로 해석돼 multi-zone에서 동작 안 함.

### 자주 틀리는 지점

| 상황 | 올바른 방식 | 틀린 방식 |
|---|---|---|
| iss 내부 페이지 네비 | `<Link href="/browser">` (basePath auto-prepend) | `<a href="/browser">` — basePath 안 붙어 shell의 `/browser`로 감 |
| iss에서 shell로 나가기 | `<a href="/">`, `window.location.assign('/login')` | `<Link href="/">` — basePath prepend로 `/iss/`가 됨 |
| 서버 redirect to shell | `redirect('/login')` | 절대 URL — origin 노출, 이식성 낮음 |
| 미들웨어 redirect | `NextResponse.redirect(new URL(path, request.nextUrl))` | `new NextResponse(null, { headers: { Location: path } })` — Next 내부 parseURL 500 |

## 인증·세션·RBAC

### 세션

Supabase SSR(`@supabase/ssr`)이 HttpOnly 쿠키로 JWT 저장. `packages/auth`의 `createClient()`가 팩토리. 미들웨어·서버 컴포넌트·API route는 서버 클라이언트, 클라이언트 컴포넌트는 브라우저 클라이언트.

Supabase `auth.getSession()`은 JWT 검증만 하고 API 왕복 없음 — Edge 미들웨어의 Vercel 1.5s 제한 내에서 안전.

### 가드 레이어

1. **shell 미들웨어** — public path(`/login`, `/auth`, `/api/auth/`, `/api/debug`) 외엔 세션 필수. 없으면 `/login?return_to=<path>`.
2. **shell `/project` 화면** — 사용자가 속한 프로젝트 목록 표시, 선택 시 `gidp_project_id` 쿠키 set.
3. **툴 zone 미들웨어** — 세션 + `gidp_project_id` 쿠키 필수. 쿠키 없으면 shell `/project`로.
4. **툴 zone 서버 컴포넌트** — `user_project_role`·`user_project_module` 조회해서 RBAC 판정.

### 역할 모델

- **Global role** (`user_profile.role`): `Pending` | `Active` | `Admin`. Admin은 모든 프로젝트·모듈 접근.
- **Project role** (`user_project_role`): `ProjectAdmin` | `Editor` | `Viewer`.
- **Module access** (`user_project_module`): `iss`/`idx`/`drawings` × `None`/`Viewer`/`Editor`/`Admin`.

`packages/auth`의 `accessAtLeast(level, min)` 헬퍼가 비교.

## DB 모델

### Schema 분리

모듈 단위 PG schema + 공통 `project_id` 컬럼 + RLS. 이유는 `adr/0002-single-db-project-id.md`.

| schema | 주요 테이블 |
|---|---|
| `public` | `user_profile`, `user_project_role`, `user_project_module`, `project`, `tag`, `loop` |
| `iss` | `document`, `document_value`, `field_def`, `template`, `mapping_rule`, `document_revision` |
| `idx` | `index_column`, `index_record`, `index_audit_log`, `index_favorite` |
| `drawings` | `junction_box`, `cable`, `terminal`, `drawing_template`, `drawing_instance`, `drawing_revision` |

### RLS 패턴

모든 project-scoped 테이블에 `project_id BIGINT NOT NULL` + RLS policy. Policy는 `user_project_role` / `user_project_module`을 조회해서 `project_id` 일치 및 적절한 access level 확인.

`public.project`는 Admin만 insert/update 가능.

### 주요 FK

- `public.tag.project_id` → `public.project`
- `iss.document.tag_id` → `public.tag` (핵심 변화 — 이전엔 per-project schema의 tag)
- `drawings.terminal.tag_id` → `public.tag`
- `public.loop.project_id` → `public.project`

### Project code 제약

`project.project_code ~ '^[ep][0-9]{6}$'` (CHECK 제약, migration 010). 자세한 배경은 `adr/0003-project-code-format.md`.

## Tag Master 동기화

Index는 매우 wide (200+ 컬럼) — 모두를 `public.tag`에 복제하면 cross-module 쿼리가 불편. 해결:

1. `idx.index_column.is_tag_core BOOL` — Admin이 "public.tag로 내릴 컬럼"을 표시
2. `idx.index_column.tag_core_field ENUM` — 어떤 `public.tag` 컬럼과 매핑되는지 (`tag_number`, `service_description` 등)
3. 트리거 `idx_record_sync_to_tag()` (migration 006)이 `idx.index_record` insert/update 시 JSONB에서 해당 필드만 추출해 `public.tag`로 upsert

`public.tag`의 허용 core field는 `packages/domain/src/public.ts`의 `TagCoreFieldEnum`에서 관리 — DB schema와 일치해야 함.

### FGIP2 (project_id=2) 초기 sync 결과 (2026-04-21)

Phase 2 완료 시점: `is_tag_core=true` 플래그 8개 컬럼 설정 (Tag Number / Service / Instrument Type / Signal / I/O / Loop / P&ID / Location), `ex_rating`·`ex_certification` 은 유보. `public.idx_backfill_tags(2)` 로 replay 후 `public.tag` **6,727 → 27,608** (Index sync 로 20,881개 추가). 매핑 근거·유보 사유는 `adr/0006-is-tag-core-mapping.md`.

**Index-only 태그 (20k+)**: Index 등록은 되었지만 ISS spec sheet 가 없는 태그 — 설계상 ISS generation 대상이 아니며 TagList/Tag 상세에서 "No documents" 가 정상. 반면 Index 전용 Tag 상세 페이지 (`apps/index/src/app/tag/[tagId]/page.tsx`) 는 core 필드 + 원본 JSONB 를 표시해 검수 가능.

## Drawings 파이프라인 (Phase 3)

계획만 — 아직 미구현.

1. 사용자가 `apps/drawings`에서 JB + Cable + Terminal 업로드 또는 편집
2. Generate 버튼 → `app/api/drawings/generate/route.ts`가 shell 세션 검증 → `services/drawing-gen`(FastAPI)에 호출
3. FastAPI가 Supabase에서 관련 데이터 pull → ezdxf로 DXF 생성 → reportlab/matplotlib로 PDF 생성 → Supabase Storage의 `drawings/` 버킷에 저장
4. Signed URL을 응답 → 브라우저 다운로드

도면 필수 필드(draftsman reject 방지용)는 `PLAN.md` Phase 3 참조.

## 데이터 이관 전략

**원칙**: 기존 ISS·Index Supabase를 건드리지 않음. read-only connection으로 SELECT만.

| 시점 | 동작 |
|---|---|
| Day 0 (Phase 1) | `scripts/snapshot-iss-to-gidp.ts` 로 레거시 ISS `e230350` schema 전체를 GIDP `public.tag` + `iss.*` 로 복제 (project_id=2 고정, source pk 유지, `ON CONFLICT DO UPDATE` 멱등, `SET TRANSACTION READ ONLY` 안전장치). Index 는 스냅샷 스크립트 대신 사용자가 GIDP index 앱에 `.xlsb` 를 직접 업로드. |
| Phase 2~5 개발 중 | 기존 DB는 계속 쓰기, GIDP는 Day 0 스냅샷 그대로 (필요 시 주 1회 재스냅샷) |
| Phase 6 Cutover | 기존 DB를 read-only로 전환 → delta 재동기화 → DNS 전환 → 기존 Supabase 30일 유지 후 archive |

auth.users 복제는 Supabase 제약으로 직접 불가 — 비밀번호 재설정 메일 플로우 또는 GIDP 신규 가입으로 우회. email 기준 `user_profile` 매핑.
