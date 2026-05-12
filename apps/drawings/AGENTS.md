# apps/drawings — agent notes

Drawings 앱은 Phase 3 신규 zone (port 3003, basePath `/drawings`). 현재는 IIS (Instrument Installation Schedule) 자동 생성에 집중. JB Wiring · Loop · Hook-up 은 IIS 안정화 후 착수.

## IIS 현황 (베타: branch `beta/iis-v0.1`)

### 완료
- **Column mapping editor** — `/iis/mapping` — 7 템플릿 (SA-2781A~E, SA-2799, SA-7076) 출력 컬럼을 idx 컬럼 / iss 필드 / 상수로 매핑. Multi-idx 연결 (배열 + separator) 지원.
- **Classification rules editor** — `/iis/classification` — tag number 의 **function key** (예: `D44-403-PT-3005` → `PT`) 에 대한 prefix / regex 라우팅 (priority). 좌측 편집, 우측 라이브 미리보기.
- **Generation UI** — `/iis/generate` — 템플릿 선택 (또는 Auto), `loop_mid_letter` 필터, `rev_no` / `doc_no` 입력 → POST 호출 → ZIP 다운로드. `GenerationForm.tsx` 의 `URL.revokeObjectURL` 은 60s setTimeout 으로 지연 (즉시 revoke 시 "Save As" 다이얼로그 전에 blob 무효화되어 silently 취소되는 Chrome/Edge 버그 회피).
- **Generate route** — `POST /api/iis/generate` — `mode='single'` 단일 페이지 xlsx, `mode='all'` 전체 페이지 ZIP, `mode='auto'` classification rule 로 모든 태그를 템플릿별 자동 버킷팅 → 템플릿별 디렉토리 ZIP (per-page xlsx + MERGED + UNCLASSIFIED.csv + SUMMARY.txt). `loop_mid_letter` 필터 (P/T/F/L) 는 모든 mode 에서 사용 가능. ISS 필드 (예: SA-2799 의 INLET/OUTLET SIZE·RATING, ORIFICE AREA, SET PRESSURE) 도 027 RPC 로 bulk fetch 후 stamp.
- **DB 스키마** — migrations 015~027. 핵심 테이블:
  - `drawings.iis_template_layout` — 템플릿별 layout (banner / data row range / header cells / page_no_cell / rev_no_cells / doc_no_cell)
  - `drawings.iis_column_mapping` — output 컬럼 → 소스 매핑 (single idx 또는 array of idx + separator, 또는 iss field, 또는 constant)
  - `drawings.iis_classification_rule` — function_key prefix / regex → template_code 라우팅 (021 까지는 instrument_type 기반이었으나 023 에서 function_key 로 전환, 기존 룰 truncate)
  - `drawings.iis_document_meta` — 문서별 revision / dcc number (현재는 비어있음, #14 에서 채움)
- **RPC**:
  - `drawings.iis_fetch_tags_page(project, mid_letter, columns, limit, offset)` — SECURITY DEFINER, paginated. mode='single' 에서만 사용.
  - `drawings.iis_fetch_all_tags_jsonb(project, mid_letter, columns)` — 025. mode='auto' 의 단일 bulk fetch. `RETURNS jsonb` (jsonb_agg 로 wrap) — PostgREST 가 `RETURNS TABLE` / `SETOF` RPC 에 silently 적용하는 implicit `LIMIT 2000` 회피.
  - `drawings.iis_fetch_tags_by_function_keys(project, function_keys[], mid_letter, columns)` — 026. mode='all' 에서 caller 가 sortedRules 로 라우팅 target 의 function_keys 를 미리 계산해서 넘기면 server-side filtering. NULL/empty array 면 필터 없음.
  - `drawings.iis_fetch_iss_values(project, field_ids[], tag_numbers[])` — 027. ISS-sourced 컬럼을 위한 bulk fetch (`iss.document` ⨝ `public.tag` ⨝ `iss.document_value`). `RETURNS jsonb` 로 row-limit 회피, `tag_number` 키 (tag_id 가 아니라) — IIS RPC 들이 `record_id + tag_number` 만 project 하므로.
  - `drawings.iis_function_key_summary(project)` — function_key 별 태그 수 + 대표 instrument_type (classification 미리보기용). 023 에서 `iis_instrument_type_summary` 를 대체.
  - `drawings.tag_function_key(text)` — tag_number → function_key 추출 (마지막에서 두 번째 hyphen segment). IMMUTABLE.

### 진행 / 보류 (#tasks)
- **#13** xlsx generation engine — 1차 완료, classification 기반 자동 라우팅 + 머지 (#15) + ISS 필드 wiring (#16) 완료.
- **#14** Document list / create / edit UI — `iis_document_meta` 활용. revision · dcc number 입력 → 생성 시 header cell 에 스탬프.
- ~~**#15**~~ ✓ 023 에서 완료. function_key 기반 classification + `mode=auto` (템플릿별 디렉토리 ZIP + UNCLASSIFIED.csv + SUMMARY.txt).
- ~~**#16**~~ ✓ 027 에서 완료. ISS-sourced 컬럼 (예: SA-2799 INLET SIZE 등) wiring. 이전엔 stub 으로 공란.

## 구현 메모

### Column mapping 의 newline 이슈
일부 idx column 이름에 `\n` 이 포함 (예: `36_INSTRUMENT MOUNTING DRAWING NO.\n(POINTS AND LINES LAYOUT)`). 브라우저 `<datalist>` 가 single-line `<input>` 에 값을 채울 때 `\n` 을 space 로 치환하므로 strict equality 비교가 실패. `normalizeName(s)` (`MappingEditor.tsx`) 로 `\s+` → 단일 space 정규화 후 비교.

### Multi-idx 연결
같은 cell 에 2개 이상 idx 값을 합쳐서 넣어야 하는 경우 (예: SA-7076 AY = "TYPE SIZE RATING"). `iis_column_mapping.source_idx_column_ids` (BIGINT[]) + `concat_separator` (default ' '). scalar `source_idx_column_id` 와 mutually exclusive — CHECK 제약 두 개 (one_source_chk + idx_scalar_xor_chk).

### Generate route 흐름
`mode='single'` → 한 페이지 xlsx 반환. `mode='all'` → classification rule 평가 후 라우팅 target 의 function_keys 를 027 RPC 에 넘겨 server-side filtering → 페이지별 xlsx 와 누적 태그를 모음 → 외부 ZIP 에 per-page + `MERGED.xlsx` 동봉. `mode='auto'` → 모든 태그를 classification rule 로 자동 버킷팅 → 템플릿별 `<code>/<code>_pageNNN.xlsx` + `<code>/<code>_MERGED.xlsx`, 미매칭 태그는 `UNCLASSIFIED.csv`, 통계는 `SUMMARY.txt`. MERGED 는 template 의 banner/merge/styling 을 모두 제거하고 첫 행에 header (output_label), 이후 행에 데이터를 A,B,C... 순서로 압축. 모든 응답은 `Buffer.from(zipBytes)` + `Content-Length` header — chunked encoding 잔존 (.tmp) 방지.

### ISS 컬럼 fetch (027)
auto / all / single 세 모드 모두: 페이지 렌더 직전에 `collectIssFieldIds(mappings)` + 해당 모드의 tag_numbers 로 한 번의 RPC 호출 → `IssValueMap = Map<tag_number, Map<field_id, value_text>>` 빌드 → `resolveValue` 에서 `issByTag.get(tag.tag_number)?.get(m.iss_field_id)` 로 O(1) lookup. tag_number 키 비교는 정상 (sync trigger 가 idx 데이터에 trim 을 적용하지 않지만 실제 데이터에 whitespace 가 없어서 byte-equal). field_id 도 양쪽 모두 int4 → JS number 로 호환.

### 대용량 stamp 성능 (sheet index)
`buildSheetIndex(doc)` 가 sheetData 를 한 번 walk 해서 `rowMap: Map<row#, <row>>` + `cellMaps: Map<row#, Map<cellRef, <c>>>` 캐싱. 이후 `writeTextCell` 은 O(1). 안 하면 N cells 쓸 때 O(N×M) DOM walk → SA-2799 mode='all' (398 tags / 11 pages × ~240 writes) 가 30s 넘어 shell 의 multi-zone proxy 가 ECONNRESET (undici fetch headersTimeout). 적용 후 33.7s → 11.5s.

### Classification 평가 위치
023 부터 classification 은 generate route 의 JS 에서 평가 (`extractFunctionKey` + `classifyFunctionKey` in `route.ts`). 미리보기 UI (`ClassificationEditor.tsx`) 와 동일 로직이므로 미리보기와 실제 결과가 항상 일치. Postgres-side classification RPC 는 의도적으로 만들지 않음 — JS 평가가 단일 source of truth.

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
