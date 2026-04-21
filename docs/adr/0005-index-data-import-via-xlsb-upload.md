# ADR 0005 — Index 초기 데이터는 `.xlsb` 사용자 업로드로 이관 (스냅샷 스크립트 불필요)

**Status**: Accepted (2026-04)

## Context

Phase 1 데이터 이관 원안(PLAN.md)은 레거시 ISS·Index Supabase 두 프로젝트 각각에 대해 read-only 스냅샷 스크립트(`scripts/snapshot-iss-to-gidp.ts`, `scripts/snapshot-index-to-gidp.ts`)를 작성해 GIDP 로 복제하는 것이었다.

실제 착수 시점(2026-04-21) 사용자가 다음과 같이 결정:

> "ISS DB 복제하는건 e230350 project 의 data 만 복제하면 되고, Index 의 DB 는 내가 excel (.xlsb) 를 통해서 Upload 를 진행할께."

Index 앱은 이미 `.xlsb` 일괄 업로드 → `idx.index_record`(JSONB) → 트리거 → `public.tag` 파이프라인을 갖고 있음. 즉 스냅샷 경유하지 않고도 "GIDP index 앱 열고 파일 드롭" 한 스텝으로 Day 0 데이터 시드가 가능.

## Decision

- **ISS**: `scripts/snapshot-iss-to-gidp.ts` 작성. `lyqsabfezsmapbzdnlko.e230350.*` → `crtsgykvmowpxqfqchgy.iss.*` + `public.tag`, `project_id=2` 고정, source pk 유지, `ON CONFLICT DO UPDATE` 멱등, `SET TRANSACTION READ ONLY` 안전장치.
- **Index**: 스냅샷 스크립트 작성하지 않음. 사용자가 기존 `.xlsb` 파일(또는 레거시 Index Supabase 에서 export 한 파일)을 GIDP `apps/index` 의 업로드 UI 를 통해 직접 업로드. 이미 검증된 파이프라인을 그대로 사용.

## Consequences

**Good**
- 작성·유지보수 대상 스크립트 1개 감소. 두 원본 DB의 schema/credential 관리 부담 절반.
- Index 측 `idx.index_column.is_tag_core` 플래그 지정·수정이 업로드 시점에 함께 이뤄짐 — 프로그램적 추측 불필요.
- 트리거 `idx_record_sync_to_tag()` 가 실제 업로드 경로에서 동작하므로 Phase 2 sync 검증이 자연스럽게 포함됨.

**Bad / 주의사항**
- `.xlsb` 는 사용자 수동 작업이라 Day 0 재현성·시각이 사람에 의존. 자동화 필요성이 생기면 별도 ADR 로 스냅샷 스크립트 추가 검토.
- ISS 와 Index 두 경로가 비대칭 — 온보딩 시 "둘 다 스크립트로 이관된다"는 오해 방지 위해 PLAN.md·architecture.md 에 명시.
- Phase 6 Cutover 시 ISS 는 스크립트로 delta 재동기화 가능하지만 Index 는 사용자가 `.xlsb` 를 다시 올려야 함 → Cutover 런북에 이 스텝을 명시적으로 포함해야 함.

**Revisit 조건**: Index 원본이 레거시 Supabase 에서 계속 편집되어 `.xlsb` 재업로드로는 따라잡기 어려운 drift 가 발생하거나, Phase 6 freeze window 단축이 필요하면 재검토.
