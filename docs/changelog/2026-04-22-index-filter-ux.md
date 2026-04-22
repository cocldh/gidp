# Index App — Filter & UX 개선 (2026-04-22)

## 변경 범위

`apps/index` 전용 변경. 다른 zone(shell/iss)·Supabase 스키마에는 영향 없음.  
단, **`supabase/migrations/011`** — RLS 정책 버그 수정(아래 참조).

---

## 1. Excel 스타일 커스텀 필터 (`ExcelStyleFilter.tsx` 신규)

AG Grid Community 기본 텍스트 필터를 Excel 스타일 커스텀 필터로 교체.

### 텍스트 필터 (다중 조건)
- 연산자 선택 + 값 입력으로 첫 번째 조건 구성
- 첫 번째 값 입력 시 **AND / OR** 토글 + 두 번째 조건 자동 표시
- 지원 연산자: 포함 / 포함하지 않음 / 같음 / 같지 않음 / 시작 / 끝

### 값 필터 (체크박스 목록)
- 해당 컬럼의 유니크 값 ≤ 500개일 때만 표시 (초과 시 텍스트 필터만)
- 목록 내 검색 + 텍스트 필터 조건과 실시간 연동 (입력 시 해당 조건에 맞는 값만 목록에 표시)
- 모두 선택 체크박스 (indeterminate 상태 지원)

### 적용 방식 (지연 적용)
- 조건 변경은 즉시 반영되지 않음
- **필터 적용** 버튼 또는 텍스트 입력창에서 **Enter** 키로 적용
- **필터 초기화** 버튼: 해당 컬럼 필터만 초기화 (상단 바 "Clear Filters"는 전체 초기화)
- 패널 재오픈 시 마지막 적용 상태 복원

---

## 2. 헤더/바디 컬럼 너비 정렬 수정 (`DataGrid.tsx`, `globals.css`)

**원인**: 커스텀 `::-webkit-scrollbar { width: 8px }` CSS가 AG Grid 초기화 타이밍보다 늦게 적용되어 헤더(15px 기준 보정)와 바디(8px 실제 렌더)가 7px 어긋남.

**수정**:
- `alwaysShowVerticalScroll={true}` — 스크롤바를 항상 표시해 측정값 일관 유지
- `.ag-body-vertical-scroll`, `.ag-body-horizontal-scroll`에 8px 명시적 선언

---

## 3. 컬럼 기본 순서 고정 (`page.tsx`)

- 첫 로딩 시 **`1_TAG NUMBER`** 컬럼을 `order_index` 무관하게 **ID 바로 다음** 고정
- `1_TAG NUMBER` 컬럼을 `ID`와 함께 **좌측 pinned** 처리 → 수평 스크롤 시 항상 표시

---

## 4. 컬럼 이름으로 이동 (`page.tsx`)

상단 바에 **컬럼 이동 검색창** 추가.

- 입력 시 매칭되는 첫 번째 컬럼으로 이동, pinned 컬럼 바로 오른쪽에 위치
- `n/m` 형식으로 매칭 개수 표시
- **Enter / →**: 다음 매칭, **←**: 이전 매칭
- 스크롤 방식: AG Grid 내부 수평 스크롤바(`.ag-body-horizontal-scroll-viewport`)를 통해 구동 → pinned 컬럼 레이아웃 유지

---

## 5. RLS 버그 수정 — `011_idx_audit_update_policy.sql`

**버그**: `idx.index_audit_log`에 `INSERT` 정책만 있고 `UPDATE` 정책이 없어, Change Log 패널의 Commit 버튼이 `committed=true` + `commit_description` 업데이트를 silently 차단.  
`error=null`이지만 0 rows 업데이트 → UI에는 커밋 완료처럼 보이나 DB 미반영.

**수정**: Editor 권한에 UPDATE 정책 추가.

```sql
CREATE POLICY idx_audit_update ON idx.index_audit_log FOR UPDATE
  USING (public.has_module_access(project_id, 'idx', 'Editor'))
  WITH CHECK (public.has_module_access(project_id, 'idx', 'Editor'));
```
