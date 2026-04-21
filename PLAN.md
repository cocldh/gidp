# GIDP (GS Instrument Data Platform) 통합 구축 플랜

## Context

GS Engineering 계장설계팀의 EPC 프로젝트 실무에서 현재 **ISS**(Instrument Specification Sheet, `D:\backup01\Desktop\python\ISS`)와 **Index**(Master Instrument Index, `D:\backup01\Desktop\python\Index`) 두 독립 웹앱이 완성되어 있으나, 서로 데이터/인증/UI가 단절되어 있고 Loop/Wiring/Hook-up 등 핵심 계장 성과품 자동생성 기능이 없다.

이번 작업은 두 앱을 **GIDP**라는 단일 플랫폼 아래로 흡수하고, 계장 데이터 라이프사이클 전체(Master Register → Spec Sheet → 도면/리스트 산출)를 다루는 통합 시스템으로 확장한다. 1차 납품 성과품(MVP)은 **JB Wiring Diagram**의 DXF+PDF 자동 생성이다.

사용자 확정 결정사항:
- 통합 전략: **모노레포 흡수** (pnpm workspaces + Turborepo)
- DB: **단일 Supabase 프로젝트로 통합** — 단, **기존 ISS/Index Supabase는 읽기/쓰기 상태 그대로 유지**하고 GIDP용 **신규 Supabase 프로젝트**를 별도 생성하여 **단방향 스냅샷 복제**로 초기 데이터 구성
- **병행 운영 원칙**: GIDP 완성(Phase 6 Cutover) 전까지 기존 iss-web·Index는 원래 Supabase에 연결된 채 그대로 사용. GIDP는 별도 Supabase/도메인에서 독립적으로 개발·검증
- 도면 출력: **DXF (ezdxf) + PDF (reportlab/matplotlib)** 우선
- MVP: **Wiring Diagram 먼저** (Cable Schedule, JB Terminal 스키마 선행 구축 필요)

결과물: `D:\backup01\Desktop\python\gidp\` 아래에 GIDP 모노레포 신규 구축. 기존 `ISS/`, `Index/` 폴더는 **코드 복사(git subtree) 시점에도 원본 그대로 유지**. 코드/데이터 모두 Phase 6 Cutover 시점에 비로소 원본을 archive 처리.

---

## 1. 전체 아키텍처 요약

```
gidp/
├── apps/
│   ├── iss/              # ISS/iss-web에서 이관 (Next.js 16 + React 19)
│   ├── index/            # Index/에서 이관 (Next.js 16, AG Grid)
│   └── drawings/         # 신규 — Wiring/Loop/Hook-up UI
├── services/
│   └── drawing-gen/      # 신규 — Python FastAPI (ezdxf + reportlab)
├── packages/
│   ├── ui/               # 공통 컴포넌트 (Navbar, RoleGuard, TagList)
│   ├── auth/             # Supabase SSR client + middleware + RBAC hooks
│   ├── db/               # Supabase 생성 타입 + 쿼리 헬퍼
│   ├── domain/           # Tag/Loop/Cable/JB/Terminal zod 스키마
│   └── config/           # tsconfig/eslint/tailwind preset
├── supabase/
│   ├── migrations/       # 단일 통합 스키마 SSOT
│   └── seed/
├── scripts/              # 데이터 이관 스크립트 (ISS DB → GIDP, Index DB → GIDP)
├── legacy/
│   └── iss-tkinter/      # iss_gui_local.py 아카이브 (read-only)
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

**DB 스키마 근본 전환**: ISS 기존의 "프로젝트당 Postgres schema 분리" 패턴(`proj_alpha.tag`, `proj_beta.tag`)을 **폐기**하고, 모듈 단위 schema + 모든 테이블의 `project_id` 컬럼 + RLS 패턴으로 통합.

```
public     — user/project/tag/loop 마스터 (cross-cutting)
iss        — document/template/mapping_rule/revision (ISS 모듈)
idx        — index_record/index_column/index_audit (Index 모듈)
drawings   — junction_box/cable/terminal/drawing_instance (신규)
```

이유: cross-module 쿼리(한 Loop에 속한 tag + 그 tag의 ISS document + 연결된 Cable)가 per-project schema에서는 `search_path` 조작이 필요하고 PostgREST와 충돌. Column 기반 RLS가 단순하고 cross-module FK가 자연스러움.

**데이터 흐름(계장 설계 관점)**:
```
Index(.xlsb 일괄 업로드)
  └─> idx.index_record (JSONB overlay, 200+ columns)
        └─ trigger sync → public.tag (is_tag_core 컬럼만)
             ├─> iss.document (Spec Sheet 연결)
             ├─> drawings.terminal.tag_id (JB 단자 연결)
             └─> public.loop (Loop Diagram 근거)
```

---

## 2. Phase별 실행 로드맵

### Phase 0 — Monorepo Skeleton (3~5일)

**목표**: `gidp/` 빈 모노레포 + 빈 공용 패키지 구조 + CI

생성 파일:
- `D:\backup01\Desktop\python\gidp\package.json` (root)
- `D:\backup01\Desktop\python\gidp\pnpm-workspace.yaml`
- `D:\backup01\Desktop\python\gidp\turbo.json`
- `D:\backup01\Desktop\python\gidp\.npmrc` (Windows 심볼릭 링크 대응: `node-linker=hoisted` 고려)
- `D:\backup01\Desktop\python\gidp\packages\config\tsconfig.base.json`
- `D:\backup01\Desktop\python\gidp\packages\config\tailwind.preset.cjs`
- `D:\backup01\Desktop\python\gidp\packages\{ui,auth,db,domain}\package.json` (각각 빈 entry)
- `D:\backup01\Desktop\python\gidp\.github\workflows\ci.yml` (turbo run build test lint)

액션:
1. `gidp/` 폴더 신규 git init (별도 repo). `python/` 최상위는 git repo 아니므로 무관.
2. 신규 Supabase 프로젝트 생성(Pro plan — drawings Storage + 이관 데이터 용량 대응).
3. `.env.example` 작성 — `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DRAWING_GEN_URL`.

리스크: Windows 경로 길이/심볼릭 링크 — `.npmrc`에 `node-linker=hoisted` 설정 또는 WSL2 개발. 개발자 모드(Windows 11) 활성화 확인.

---

### Phase 1 — 앱 코드 복사 + 스냅샷 DB + 통합 인증 (2주)

**목표**: `ISS/iss-web` → `gidp/apps/iss`, `Index/` → `gidp/apps/index` **코드 복사**. 두 앱이 **신규 GIDP Supabase**에 연결되어 단일 로그인 세션으로 동작. 기존 Supabase와 기존 iss-web/Index 배포는 손대지 않음.

**병행 운영 핵심 원칙**:
- 기존 ISS Supabase, Index Supabase는 read-write 그대로 — 실무 사용자 계속 사용
- GIDP Supabase는 완전 별도 프로젝트 — 초기 데이터는 **Day 0 스냅샷 복제**로만 채움
- GIDP는 별도 도메인/Vercel 프로젝트로 dev·staging 용도 운영
- 개발 기간 중 기존 DB에 신규 데이터가 쌓여도 GIDP는 영향 없음 (Phase 6에서 delta 재동기화)
- 기존 앱 소스(`D:\backup01\Desktop\python\ISS\`, `\Index\`)는 subtree 복사 이후에도 **원본 그대로 유지** — git subtree는 복사만 하고 원본을 변형하지 않음

#### 1-1. 코드 복사 (subtree, 원본 보존)

```
cd D:\backup01\Desktop\python\gidp
git subtree add --prefix=apps/iss   ../ISS          main
git subtree add --prefix=apps/index ../Index        main
```

- 원본 `python/ISS/`, `python/Index/`는 **그대로 유지**. subtree는 히스토리만 가져오고 원본 파일 시스템을 건드리지 않음.
- `apps/iss/iss-web/*` 구조는 한 단계 끌어올려 `apps/iss/*`로 정리 (별도 후속 커밋).
- blame 보존 필요 시 filter-repo 방식으로 변경 가능 — 권장은 subtree.

#### 1-2. 공용 패키지 추출

**`packages/auth`** — 재사용 원본:
- `D:\backup01\Desktop\python\ISS\iss-web\src\lib\supabase-server.ts`
- `D:\backup01\Desktop\python\ISS\iss-web\src\lib\supabase-client.ts`
- `D:\backup01\Desktop\python\ISS\iss-web\src\lib\supabase-admin.ts`
- `D:\backup01\Desktop\python\ISS\iss-web\src\middleware.ts`

→ `createClient({ env })` 팩토리로 통합, `createAuthMiddleware(config)` export.
→ `useProjectRole()`, `requireRole(module, access)` 서버 헬퍼 제공.

**`packages/ui`** — 재사용 원본:
- `D:\backup01\Desktop\python\ISS\iss-web\src\components\Navbar.tsx`
- `D:\backup01\Desktop\python\ISS\iss-web\src\components\RoleGuard.tsx`
- `D:\backup01\Desktop\python\ISS\iss-web\src\components\TagList.tsx`

→ module-aware Navbar로 개조 (ISS/Index/Drawings 탭 분기).

**`packages/domain`** — 신규 zod 스키마:
- `Tag`, `Project`, `UserRole`, `Loop` (public schema 대응)
- `Document`, `Template`, `Revision` (iss schema 대응)
- `IndexRecord`, `IndexColumn` (idx schema 대응)
- `JunctionBox`, `Cable`, `Terminal`, `DrawingInstance` (drawings schema 대응)

#### 1-3. 통합 Supabase 스키마 마이그레이션

생성 파일: `D:\backup01\Desktop\python\gidp\supabase\migrations\`
- `001_public_master.sql` — user_profile, user_project_role, project, user_project_module, tag, loop
- `002_iss_schema.sql` — iss.document, iss.document_value, iss.field_def, iss.template, iss.mapping_rule, iss.mapping_option, iss.document_revision, iss.document_revision_detail, iss.document_value_change
- `003_idx_schema.sql` — idx.index_column (with is_tag_core bool), idx.index_record, idx.index_audit_log, idx.index_favorite
- `004_drawings_schema.sql` — junction_box, cable, terminal, drawing_template, drawing_instance, drawing_revision
- `005_rls_policies.sql` — 전 테이블 `project_id` 기반 RLS + module 권한 연동
- `006_triggers.sql` — `idx_record_sync_to_tag()` (JSONB의 is_tag_core 플래그 컬럼을 public.tag로 upsert)

재사용 참고:
- `D:\backup01\Desktop\python\ISS\sql\01_create_project_registry.sql` — project 테이블 구조
- `D:\backup01\Desktop\python\ISS\sql\02_new_project_template.sql` — document/field_def/template 구조 (schema만 iss.로 재명명 + project_id 추가)
- `D:\backup01\Desktop\python\ISS\sql\03_unified_user_roles.sql` — user_profile/user_project_role
- `D:\backup01\Desktop\python\ISS\supabase\migrations\` — 기존 RLS 참고용

**핵심 변경**: `document.tag_id`의 FK 대상이 `{proj_schema}.tag` → `public.tag`로 변경. 이 한 줄이 schema 분리 폐기의 실체.

#### 1-4. 데이터 스냅샷 복제 스크립트 (단방향, 기존 DB 불변)

**접근 방식**: 기존 Supabase에 **읽기 전용 연결**만 수립. 기존 DB에는 `SELECT` 쿼리만 실행하고 어떤 DDL/DML도 발생시키지 않음. 이관이 아닌 **복제(copy)** 이므로 기존 앱의 가동에 전혀 영향 없음.

`D:\backup01\Desktop\python\gidp\scripts\snapshot-iss-to-gidp.ts`
- 기존 ISS Supabase에 read-only role로 접속 → project 목록 조회 → 각 per-project schema 탐색
- `{proj}.tag` → GIDP `public.tag` (project_id 부여, tag_id 매핑 테이블 생성)
- `{proj}.document` → GIDP `iss.document` (tag_id 재맵핑, project_id 부여)
- 나머지 iss.* 테이블 동일 패턴
- user_profile/user_project_role 복제 (기존 auth.users 그대로 가져오는 건 Supabase 제약으로 불가 → 비밀번호 재설정 메일 방식 또는 GIDP에서 신규 가입 유도)
- **실행 후 기존 ISS Supabase 상태 무변화** 검증 (체크섬 비교)

~~`D:\backup01\Desktop\python\gidp\scripts\snapshot-index-to-gidp.ts`~~ — **폐기(ADR 0005)**. Index 초기 데이터는 사용자가 `.xlsb` 를 GIDP `apps/index` 업로드 UI 로 직접 올린다. 기존 파이프라인(`idx.index_record` JSONB → 트리거 → `public.tag`)을 그대로 사용하므로 별도 스크립트 불필요.

**기술 수단 후보**:
- `pg_dump --schema-only` + `pg_dump --data-only --schema=<proj>` (Supabase는 connection string 제공) → 별도 Python/TS 스크립트로 schema/project_id 변환하며 `pg_restore`
- 또는 TS/Python에서 직접 `SELECT` → `INSERT` (더 제어하기 쉬움, 200만 행 이하 규모라면 충분)
- 권장: 후자 (TS 스크립트로 schema 변환 로직이 명시적)

**개발 기간 중 데이터 드리프트 처리 방침**:
- Day 0 스냅샷 이후 기존 DB에 추가된 데이터는 GIDP에 반영되지 **않음** — 이는 의도된 동작
- Phase 2~5 기간 동안 기존 DB가 커지는 만큼 Phase 6 최종 재동기화 시 delta 처리량 증가 → 대응책은 Phase 6 항목 참조
- 필요 시 주 1회 스냅샷 재실행으로 gap 축소 가능 (스크립트 멱등성 확보)

**Supabase 브랜치 활용**: GIDP Supabase 자체에서 `mcp__claude_ai_Supabase__create_branch`로 migration dry-run. 기존 ISS/Index Supabase는 branching 건드리지 않음.

#### 1-5. 양 앱 포팅 작업

- `apps/iss/` — 기존 schema-per-project 전제 코드 수정. 대표적으로:
  - `D:\backup01\Desktop\python\ISS\iss-web\src\app\api\generate\route.ts` — 쿠키 `iss_project`로 schema 변경하던 로직을 `project_id` 쿼리 파라미터 기반으로 변경
  - `createSchemaClient()` 호출부 전부 → `createClient()` + `.eq('project_id', ...)`
- `apps/index/` — 인증 미적용 상태 → `packages/auth` 적용. `DataGrid.tsx`에서 anon client 제거하고 SSR client 사용. RoleGuard로 감싸기.

#### 1-6. GIDP 전용 배포 (기존 배포 병행)

- **기존 iss-web, Index 배포는 그대로 유지** — 기존 Vercel 프로젝트, 기존 Supabase 연결, 기존 도메인 전부 무변화
- GIDP는 **별도 Vercel 프로젝트 3개** 신규 생성: 예) `iss.gidp-dev.gsenc.com`, `index.gidp-dev.gsenc.com`, `drawings.gidp-dev.gsenc.com` (또는 Vercel 기본 preview 도메인)
- GIDP Vercel 프로젝트들은 GIDP Supabase에만 연결
- 공통 쿠키 도메인 `.gidp-dev.gsenc.com`로 SSO 확보
- 실제 사용자는 여전히 기존 iss-web / Index 도메인 사용. GIDP는 개발팀/QA만 접근

**검증**:
- 기존 ISS 사용자가 기존 ISS 도메인에 로그인 → 기존 동작 완전 동일 (GIDP 작업의 어떤 것도 영향 미치지 않음)
- GIDP staging 도메인(`iss.gidp-dev.gsenc.com`)에 로그인 → Day 0 스냅샷 데이터로 기존 기능 동작
- GIDP에서 테스트 데이터 수정해도 기존 Supabase·기존 앱에 전혀 반영 안 됨 (완전 분리 확인)
- 한 사용자가 `iss.gidp-dev`에서 로그인 후 `index.gidp-dev` 접근 시 재로그인 없이 세션 유지

리스크:
- **RLS 정책 재작성**: 기존 per-schema policy는 GIDP에서는 폐기. project_id 기반으로 전면 재작성 필요. GIDP Supabase 브랜치에서 회귀 테스트.
- **Index 컬럼 헤더 불일치**: JSONB 키 casing 혼재(`Tag Number` vs `TAG NUMBER`) — 트리거에서 `lower()` 정규화.
- **auth.users 복제 불가 이슈**: Supabase의 `auth.users` 테이블은 프로젝트 간 직접 복제가 제한됨. Phase 1에서 기존 ISS 사용자는 GIDP 첫 접속 시 비밀번호 재설정 또는 SSO 신규 가입으로 유도. user_profile(public)의 매핑은 email 기준으로 재연결.

---

### Phase 2 — Tag Master 통합 (1주) — **완료 (2026-04-21, FGIP2)**

**목표**: Index의 200+ 컬럼 중 계장 데이터 핵심 필드를 `public.tag`에 동기화. ISS/Drawings가 동일한 tag를 바라보도록.

액션:
1. ✅ 사용자 리뷰 — `is_tag_core` 플래그 지정 8개 확정 (Tag Number / Service / Instrument Type / Signal / I/O / Loop / P&ID / Location). `ex_rating`·`ex_certification` 유보 — `docs/adr/0006-is-tag-core-mapping.md`.
2. ✅ 트리거 `idx_record_sync_to_tag()` 활성화 + `public.idx_backfill_tags(2)` 로 27,603 레코드 replay. `public.tag` 6,727 → 27,608.
3. ✅ `apps/iss`의 TagList 이미 `public.tag` 기반 (복제 이후 포팅된 상태 그대로 재사용).
4. ✅ `apps/index/src/app/tag/[tagId]/page.tsx` — Index 전용 Tag 상세. core 필드 + 연결된 ISS documents + 원본 JSONB 표시. Index-only 태그는 "ISS spec sheet 대상 아님" 안내.

재사용 원본:
- `D:\backup01\Desktop\python\ISS\iss-web\src\components\TagList.tsx` → `packages/ui/TagList.tsx`로 이관, project_id 기반으로 재작성

**검증**:
- ✅ Index sync 후 샘플 태그(D44-248-AAH-0001 등) 에서 8개 필드 정상 populate
- ✅ Index-only 태그는 ISS TagList 에서 "No data found" — 설계상 정상 (사용자 확인)
- Index에서 Tag Number 수정 후 Save+Commit → 수 초 내 public.tag 반영 (추후 회귀 테스트)
- ISS에서 동일 tag 선택 → Index에서 수정한 Service Description이 반영됨 (추후 회귀 테스트)

---

### Phase 3 — Drawings MVP: JB Wiring Diagram (3~4주)

**목표**: JB 단위 Wiring Diagram의 DXF + PDF 자동 생성.

#### 3-1. `apps/drawings` Next.js 앱 scaffold

생성 파일:
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\layout.tsx` (ISS layout.tsx 참고)
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\page.tsx` — JB 리스트
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\jb\[id]\page.tsx` — Terminal 편집
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\cable\page.tsx` — Cable Schedule
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\upload\page.tsx` — Excel bulk upload (JB/Cable/Terminal 3 시트)
- `D:\backup01\Desktop\python\gidp\apps\drawings\src\app\api\drawings\generate\route.ts` — FastAPI 호출 프록시

Excel 업로드/페이스트 UX는 `D:\backup01\Desktop\python\Index\src\app\DataGrid.tsx` 복사/페이스트 로직 + `D:\backup01\Desktop\python\Index\src\app\UploadModal.tsx` 파일 업로드 패턴 재사용.

#### 3-2. `services/drawing-gen` FastAPI 서비스

생성 파일:
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\pyproject.toml` — ezdxf, reportlab, fastapi, uvicorn, supabase, pydantic
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\app\main.py` — FastAPI 엔트리 + 인증 미들웨어
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\app\render\wiring_jb.py` — JB Wiring 생성 코어
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\app\render\pdf_export.py` — DXF → PDF (matplotlib 또는 odafc 래퍼)
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\app\storage.py` — Supabase Storage 업로드
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\templates\blocks\title_block_A3.dxf` — GS 표준 타이틀 블록 (회사 기존 block 자산 필요)
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\templates\blocks\terminal_strip.dxf` — 단자대 심볼
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\templates\blocks\is_barrier.dxf` — IS 배리어
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\templates\blocks\cable_gland.dxf` — 케이블 글랜드
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\Dockerfile`
- `D:\backup01\Desktop\python\gidp\services\drawing-gen\fly.toml` — Fly.io 배포 설정

**DXF 구성 전략**: 회사 표준 block 라이브러리를 `ezdxf.Importer`로 import_blocks 하여 재사용. Procedural 코드는 block 배치 + wire polyline 연결만 담당. Layer/lineweight/dimstyle은 `drawing_template.layer_config` JSONB에서 주입. AutoCAD 호환을 위해 `DXFVERSION=AC1027` (AutoCAD 2013) 고정.

**Wiring Diagram 데이터 요구사항** (EPC 계장 도면 관점 — 이 필드들이 없으면 실무 reject):
- `terminal.side` (F/S) — 필드측/시스템측 strip 양쪽 그리기 필수
- `terminal.function` (+/-/SH/SP) — 극성과 shield, spare 표시
- `terminal.ferrule_text` — 와이어 마커 인쇄 필수 (GS 표준 도면 요건)
- `cable.shield` (OA/IS/OA+IS/NONE) + `cable.drain_wire` — shield 연속성/차단 도식
- `junction_box.is_barrier_box` + `terminal.barrier_id` — IS 회로의 배리어 블록 삽입
- `terminal.is_spare` — 예비 단자 표시 (필드 케이블 계획에 필수)
- `cable.cable_core_ref` — 코어별 와이어 라벨

멀티 시트 처리: 120 terminal을 넘는 대형 JB는 자동 시트 분할 (40/sheet 기준). 설계 첫날부터 고려.

#### 3-3. 배포

- Fly.io 단일 리전 (Supabase와 가까운 곳), Docker 이미지 ~600MB 예상
- Next.js `apps/drawings/src/app/api/drawings/generate/route.ts`가 사용자 Supabase 세션 검증 → 단발성 service JWT 생성 → FastAPI 호출
- FastAPI는 service_role key로 Supabase 직접 접근 + Storage `drawings/` 버킷에 DXF/PDF 쓰기
- Signed URL로 다운로드 제공

#### 3-4. Revision Control

`iss.document_revision` / `document_revision_detail` 패턴을 그대로 재사용해 `drawings.drawing_revision` 구현. TS 헬퍼(`packages/domain/revision.ts`)는 단일 엔진으로 공용.

**검증**:
- FGIP2-GIDP 프로젝트에서 JB 1개 업로드 (40 terminals, 5 cables, 15 tags 연결)
- "Generate" 버튼 → 수 초 내 DXF 다운로드 + PDF 미리보기
- DXF를 AutoCAD 2013+에서 열어 title block, layer, terminal strip 심볼, shield 표시가 GS 표준과 일치하는지 draftsman 확인
- Revision bump (a→b) → 변경된 terminal만 highlight 후 새 DXF 재생성

---

### Phase 4 — Loop Diagram / Cable Schedule / I/O List / Hook-up (6~8주, MVP 이후)

- **Loop Diagram**: `public.loop` + `public.tag` + `drawings.terminal` 조합. DCS/SIS 마샬링 정보 추가 테이블 필요.
- **Cable Schedule**: 이미 `drawings.cable` 모델링 완료 — Excel 출력만 추가. 참고: `D:\backup01\Desktop\python\ISS\iss_generate_from_db_with_pdf.py`의 openpyxl 패턴.
- **I/O List**: `public.tag` where `io_type is not null` View — 단순.
- **Hook-up Drawing**: 계측 유형별 block 라이브러리 확장 + `drawings.hookup_template` 추가. ISS의 Template+Mapping 매커니즘 재활용 가능 여부 검토.

---

### Phase 5 — Tkinter GUI 정리 (1주, Phase 6와 병행 가능)

`D:\backup01\Desktop\python\ISS\iss_gui_local.py` (8,441 lines) — **포팅하지 않음**. `gidp/legacy/iss-tkinter/`에 아카이브 후 read-only. Phase 6 Cutover 이후 6개월 deprecation 창 후 종료. Phase 3에서 웹 기반 DXF/PDF 생성이 완비되면 tkinter의 오프라인 가치는 소멸.

---

### Phase 6 — Production Cutover (2~3주)

**목표**: GIDP 기능 검증 완료 후 실사용자 트래픽을 기존 iss-web·Index에서 GIDP로 이전. 이 시점까지 기존 시스템은 read-write 그대로 운영됨.

**사전 조건**:
- Phase 1~4가 완료되어 기존 기능(ISS, Index) + 신규 기능(Drawings)이 GIDP에서 모두 정상 동작
- 실사용자 대상 UAT 완료 (최소 1~2주)
- 기존 대비 UX·성능 회귀 없음 확인

#### 6-1. 최종 Delta 재동기화 (freeze 최소화)

1. **Freeze 공지**: 실사용자에게 기존 iss-web·Index 기록 중단 시점 사전 공지 (보통 주말/야간 2~4시간 윈도우)
2. **기존 Supabase read-only 전환**: 기존 DB의 authenticator role을 `REVOKE INSERT, UPDATE, DELETE`로 제한 (또는 RLS 강제로 차단)
3. **Phase 1 스냅샷 스크립트 재실행**: 멱등성 보장된 snapshot 스크립트를 delta 모드로 실행 — 기존 Day 0 이후 추가/변경된 레코드만 GIDP에 upsert
4. **무결성 검증**: 주요 테이블 row count + 체크섬 비교 (기존 vs GIDP)

#### 6-2. DNS·도메인 전환

- 기존 도메인(예: 현재 iss-web Vercel 도메인)의 DNS를 GIDP Vercel 프로젝트로 전환
- 또는 GIDP 도메인을 프로덕션 도메인으로 승격 (`iss.gidp-dev` → `iss.gidp`)
- 사용자 비밀번호: auth 이전 대신 "최초 GIDP 로그인 시 비밀번호 재설정 메일" 플로우 사용

#### 6-3. 기존 시스템 Archive

- 기존 iss-web Vercel 프로젝트: 30일간 read-only + 배너 공지 후 폐기
- 기존 ISS Supabase: 30일간 read-only로 유지 후 pg_dump 백업 보관 → delete
- 기존 Index Supabase: 동일 절차
- 롤백 안전망: 30일 윈도우 내 중대 이슈 발견 시 DNS 역전환으로 복구 가능

**검증**:
- Cutover 직후 주요 KPI 모니터링: 로그인 성공률, document 생성 성공률, Index 업로드 성공률
- 1주일간 기존 도메인 접속 로그 확인 — 미이전 사용자 파악 후 개별 안내

리스크:
- **auth.users 이전 한계**: 비밀번호 재설정 플로우로 우회. 재설정 메일 다수 발송 시 Supabase SMTP 쿼터 확인 필요
- **Delta 재동기화 중 예외 데이터**: 기존 DB에서 GIDP 스키마와 호환되지 않는 신규 컬럼이 추가되었을 가능성 — freeze 직전 스키마 diff 체크 필수
- **30일 롤백 윈도우 중 데이터 정합성**: 롤백 시 GIDP에 쌓인 신규 데이터를 기존 DB로 역이관해야 함 → 사전에 역방향 스크립트 준비

---

## 3. 재사용 자산 요약

| 구분 | 원본 경로 | 이관 대상 |
|---|---|---|
| Supabase auth | `ISS\iss-web\src\lib\supabase-*.ts` | `packages/auth/` |
| Auth middleware | `ISS\iss-web\src\middleware.ts` | `packages/auth/middleware.ts` |
| RBAC 컴포넌트 | `ISS\iss-web\src\components\RoleGuard.tsx` | `packages/ui/RoleGuard.tsx` |
| Navbar | `ISS\iss-web\src\components\Navbar.tsx` | `packages/ui/Navbar.tsx` |
| TagList | `ISS\iss-web\src\components\TagList.tsx` | `packages/ui/TagList.tsx` |
| SQL 스키마 | `ISS\sql\01_*.sql` ~ `03_*.sql` | `gidp/supabase/migrations/001~003` (schema 재명명) |
| ~~Index 이관 원본~~ | ~~`Index\migrate_to_supabase.py`~~ | **폐기(ADR 0005)** — 사용자 `.xlsb` 업로드로 대체 |
| DataGrid 카피페이스트 | `Index\src\app\DataGrid.tsx` | `packages/ui/DataGrid.tsx` + `apps/drawings` 편집기 |
| Excel 업로드 | `Index\src\app\UploadModal.tsx` | `apps/drawings/src/app/upload/` |
| Revision 로직 | `ISS\iss-web` document_revision UI | `packages/domain/revision.ts` (Drawings 공용) |
| openpyxl+COM PDF | `ISS\iss_generate_from_db_with_pdf.py` | Phase 4 Cable Schedule Excel 출력 참고 |

---

## 4. End-to-End 검증 방법

Phase 완료 시 각 단계별 smoke test:

**Phase 0**:
```
cd gidp
pnpm install
pnpm turbo run build    # 빈 워크스페이스 빌드 성공
```

**Phase 1**:
```
cd gidp
pnpm dev                # apps/iss, apps/index, apps/drawings 3개 동시 기동
```
- 브라우저로 `iss.localhost:3000` 로그인 → `index.localhost:3001` 탭 이동 시 자동 로그인 유지
- 기존 ISS 프로젝트 하나 열기 → document 편집/저장 → Supabase 반영 확인
- Index 업로드 → idx.index_record + public.tag 동시 반영 확인 (트리거)

**Phase 2**:
- Supabase SQL Editor에서: `SELECT tag_number, service_description FROM public.tag WHERE project_id = X;` — Index 업로드 내용 반영 확인
- Index에서 Service 수정 → 수초 후 ISS 화면 새로고침 시 반영

**Phase 3**:
- `POST /api/drawings/generate` with `drawing_instance_id` → DXF URL 반환 < 10초
- 반환된 DXF를 AutoCAD 2013+에서 오픈 → 레이어 구조, 타이틀 블록, 단자 번호 표시 정상
- 동일 JB 재생성 → 기존 DXF는 Storage에 유지, rev bump

**회귀 테스트**:
- 기존 ISS 10개 프로젝트 모두 마이그레이션 후 기존 document 생성 기능 동작 확인
- Index의 FGIP2-GIDP Master Index xlsb 재업로드 → 데이터 일치

---

## 5. Critical Files to Create/Modify

**신규**:
- `gidp/package.json`, `gidp/pnpm-workspace.yaml`, `gidp/turbo.json`, `gidp/.npmrc`
- `gidp/supabase/migrations/001_public_master.sql` ~ `006_triggers.sql`
- `gidp/packages/auth/src/index.ts`, `gidp/packages/ui/src/index.ts`, `gidp/packages/domain/src/index.ts`
- `gidp/scripts/snapshot-iss-to-gidp.ts` (Index snapshot 은 ADR 0005 로 폐기 — `.xlsb` 업로드로 대체)
- `gidp/apps/drawings/` 전체
- `gidp/services/drawing-gen/` 전체 (Python FastAPI + ezdxf)
- `gidp/services/drawing-gen/templates/blocks/*.dxf` (GS 표준 block)

**이관**:
- `ISS/iss-web/*` → `gidp/apps/iss/*` (git subtree)
- `Index/*` → `gidp/apps/index/*` (git subtree, backend/ 제외)

**수정** (Phase 1 중):
- `gidp/apps/iss/src/app/api/generate/route.ts` — schema 쿠키 기반 → project_id 기반
- `gidp/apps/iss/src/lib/supabase-*.ts` — `packages/auth` import로 대체
- `gidp/apps/index/src/app/supabase.ts` — 삭제, `packages/auth` 사용
- 양 앱의 middleware.ts — `createAuthMiddleware` 호출로 축소

---

## 6. 미결 결정사항 (사용자 확정 필요 — 실행 시점에 확인)

실행 승인 후 Phase별 착수 직전에 확정:

1. **Git 이력 방식**: subtree(권장, 이력 보존 + 노이즈) vs filter-repo(깔끔, 해시 재작성)
2. **GIDP 개발용 도메인**: `gidp-dev.gsenc.com` 확보 vs Vercel 기본 preview 도메인
3. **Phase 6 프로덕션 도메인 전략**: 기존 도메인 재사용(DNS 전환) vs 신규 `gidp.gsenc.com` 도메인으로 전환 안내
4. **Python 서비스 호스팅**: Fly.io(권장) vs Railway vs 사내 VPS
5. **Index `is_tag_core` 컬럼 선정**: Phase 2 착수 전 30분 리뷰 필요
6. **GS 표준 DXF 블록 라이브러리 자산 존재 여부**: 없으면 Phase 3에 약 1주 추가 (드래프팅 필요)
7. **Tkinter GUI 병행 유지 기간**: Phase 6 이후 즉시 archive vs 6개월 coexistence
8. **Supabase Pro plan 승인**: **신규 GIDP 프로젝트**에 필요 (용량 + Edge Functions + Branching). 기존 ISS/Index Supabase plan은 변경 불필요
9. **스냅샷 재동기화 빈도**: Phase 2~5 개발 기간 중 주 1회 자동 재스냅샷 vs Phase 6 시점 1회 delta 재동기화만
10. **사용자 계정 이전 방식**: 비밀번호 재설정 메일 일괄 발송 vs GIDP 최초 로그인 시 개별 재설정 vs SSO 신규 가입

---

## 7. 예상 일정 (총 13~19주 to Full Cutover)

| Phase | 내용 | 기간 | 기존 시스템 영향 |
|---|---|---|---|
| 0 | Monorepo skeleton + GIDP Supabase 신규 생성 | 3~5일 | 없음 |
| 1 | 코드 subtree 복사 + Day 0 스냅샷 복제 + SSO | 2주 | 없음 (기존 DB read-only 접근만) |
| 2 | Tag Master 동기화 (GIDP 내부) | 1주 | 없음 |
| 3 | **JB Wiring Diagram MVP** | 3~4주 | 없음 |
| 4 | Loop/Cable/IO/Hookup | 6~8주 | 없음 |
| 5 | Tkinter archive (Phase 6와 병행) | 1주 | 없음 |
| 6 | **Production Cutover** (freeze → delta 재동기화 → DNS 전환 → 기존 archive) | 2~3주 | **이 시점에만 기존 시스템 종료** |

**핵심**: Phase 0~5 전 기간(11~16주) 동안 기존 iss-web·Index는 완전 정상 운영. 사용자/실무는 영향 없음.
