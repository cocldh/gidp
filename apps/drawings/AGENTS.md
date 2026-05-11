# apps/drawings — agent notes

Drawings 앱은 Phase 3 신규 zone (port 3003, basePath `/drawings`). 현재는 IIS (Instrument Installation Schedule) 자동 생성에 집중. JB Wiring · Loop · Hook-up 은 IIS 안정화 후 착수.

## IIS 현황 (베타: branch `beta/iis-v0.1`)

### 완료
- **Column mapping editor** — `/iis/mapping` — 7 템플릿 (SA-2781A~E, SA-2799, SA-7076) 출력 컬럼을 idx 컬럼 / iss 필드 / 상수로 매핑. Multi-idx 연결 (배열 + separator) 지원.
- **Classification rules editor** — `/iis/classification` — `instrument_type` 별 라우팅 규칙 (prefix / regex + priority). 좌측 편집, 우측 라이브 미리보기.
- **Generate route** — `POST /api/iis/generate` — 단일 페이지 xlsx, 또는 전체 페이지 ZIP (per-page xlsx + 검색용 `MERGED.xlsx`) 출력. `loop_mid_letter` 필터 (P/T/F/L) 와 `mode` (single/all) 지원.
- **DB 스키마** — migrations 015~022. 핵심 테이블:
  - `drawings.iis_template_layout` — 템플릿별 layout (banner / data row range / header cells / page_no_cell / rev_no_cells / doc_no_cell)
  - `drawings.iis_column_mapping` — output 컬럼 → 소스 매핑 (single idx 또는 array of idx + separator)
  - `drawings.iis_classification_rule` — instrument_type prefix / tag_number regex → template_code 라우팅
  - `drawings.iis_document_meta` — 문서별 revision / dcc number (현재는 비어있음, #14 에서 채움)
- **RPC**:
  - `drawings.iis_fetch_tags_page(project, mid_letter, columns, limit, offset)` — SECURITY DEFINER, paginated
  - `drawings.iis_instrument_type_summary(project)` — classification 미리보기용 집계

### 진행 / 보류 (#tasks)
- **#13** xlsx generation engine — 1차 완료, classification 기반 자동 라우팅과 머지 (#15) 후 마무리.
- **#14** Document list / create / edit UI — `iis_document_meta` 활용. revision · dcc number 입력 → 생성 시 header cell 에 스탬프.
- **#15** Wire classification rules into generate route — 현재 `loop_mid_letter` 단일 필터만 지원. `mode=auto` 추가해서 모든 태그를 rule 기반으로 자동 버킷팅 → 템플릿별 xlsx 일괄 생성 (ZIP 으로 묶기).

## 구현 메모

### Column mapping 의 newline 이슈
일부 idx column 이름에 `\n` 이 포함 (예: `36_INSTRUMENT MOUNTING DRAWING NO.\n(POINTS AND LINES LAYOUT)`). 브라우저 `<datalist>` 가 single-line `<input>` 에 값을 채울 때 `\n` 을 space 로 치환하므로 strict equality 비교가 실패. `normalizeName(s)` (`MappingEditor.tsx`) 로 `\s+` → 단일 space 정규화 후 비교.

### Multi-idx 연결
같은 cell 에 2개 이상 idx 값을 합쳐서 넣어야 하는 경우 (예: SA-7076 AY = "TYPE SIZE RATING"). `iis_column_mapping.source_idx_column_ids` (BIGINT[]) + `concat_separator` (default ' '). scalar `source_idx_column_id` 와 mutually exclusive — CHECK 제약 두 개 (one_source_chk + idx_scalar_xor_chk).

### Generate route 흐름
`mode='single'` → 한 페이지 xlsx 반환. `mode='all'` → loop 전체를 paginate 하면서 페이지별 xlsx 와 누적 태그를 모음 → 외부 ZIP 에 per-page + `MERGED.xlsx` 동봉. MERGED 는 template 의 banner/merge/styling 을 모두 제거하고 첫 행에 header (output_label), 이후 행에 데이터를 A,B,C... 순서로 압축.

### Classification 라이브 미리보기
`ClassificationEditor.tsx` 는 JS 에서 prefix `startsWith` 또는 `new RegExp(value).test()` 로 즉시 평가. 실제 generate 단계는 Postgres 의 `LIKE` / `~` 로 평가 — 단순 패턴 (`.*`, prefix, alternation) 은 양쪽이 같은 결과를 내지만 JS-only feature (lookbehind 등) 는 미리보기와 실제 결과가 달라질 수 있음.

### 인증 / RLS
- 모든 페이지: server-component 에서 user · profile · project · module access 4 단 가드.
- RPC: SECURITY DEFINER + 함수 본문 첫 줄에서 `has_module_access` 체크. 이유는 `idx.index_record` 의 RLS 가 per-row 평가되어 ~30K 행에서 statement_timeout 트립 (~7s). migration 019 의 코멘트 참조.

## 자주 틀리는 것

- **Zone 외부 링크는 raw `<a href="/">`** — `next/link` 는 basePath (`/drawings`) 자동 prepend 되므로 GIDP 홈 / login 으로 나갈 때는 raw anchor.
- **Server redirect 는 origin-relative** — `redirect('/login')` 은 basePath prepend 안 됨, shell 의 `/login` 으로 감.
- **Schema 명시** — `supabase.schema('drawings').from('...')` — public schema 가 아닌 테이블은 항상 명시.
- **CHECK 제약 변경 시** — 015 의 `iis_col_mapping_one_source_chk` 를 021 에서 drop 후 재정의했듯이, 기존 제약을 항상 `DROP CONSTRAINT IF EXISTS` 로 정리.

## 베타 배포 가드

`vercel.json` (repo root) 의 `git.deploymentEnabled` 가 `beta/iis-v0.1` 브랜치 푸시 시 Vercel preview 배포를 차단함. 정식 머지 전에는 로컬 (`pnpm dev`) 에서만 확인.
