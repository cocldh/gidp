# ADR 0006 — `is_tag_core` 매핑: Index 8개 컬럼만 `public.tag` 로 sync (ex_rating/ex_certification 유보)

**Status**: Accepted (2026-04)

## Context

`public.tag` 는 GIDP 전 모듈(ISS / Drawings / Loop) 이 공유하는 태그 마스터. migration 001 에서 10개 정규화 컬럼이 정의되어 있음: `tag_number`, `service_description`, `instrument_type`, `signal_type`, `io_type`, `loop_number`, `pnid_number`, `location`, `ex_rating`, `ex_certification`.

Index 측은 `idx.index_column` 에 277개 컬럼 정의 + `idx.index_record.data` JSONB overlay 구조. 트리거 `idx_record_sync_to_tag()` (migration 006) 가 `is_tag_core=true` 플래그된 컬럼만 추출해 `public.tag` 로 upsert. 즉 277 중 어느 컬럼을 10개 정규화 필드에 매핑할지는 **사용자 결정 사항**이며, 그 매핑은 `idx.index_column.tag_core_field` 에 저장됨.

FGIP2 (project_id=2) `.xlsb` 업로드 후(2026-04-21) 매핑 리뷰 결과, 8개는 명확하게 대응되는 Index 컬럼이 있었고 2개는 대응 컬럼이 없었음.

## Decision

`project_id=2` 기준 다음 8개 매핑을 `is_tag_core=true` 로 설정:

| `public.tag` 컬럼 | Index 컬럼 |
|---|---|
| `tag_number` | `1_TAG NUMBER` |
| `service_description` | `4_TAG SERVICE DESCRIPTION` |
| `instrument_type` | `3_INSTRUMENT TYPE` |
| `signal_type` | `19_SIGNAL TYPE` |
| `io_type` | `18_IO TYPE` |
| `loop_number` | `5_LOOP NUMBER` |
| `pnid_number` | `25_P&ID` |
| `location` | `17_LOCATION` |

`ex_rating` / `ex_certification` 은 **이번 라운드에서 매핑하지 않음** — `public.tag` 에 컬럼은 유지하되 NULL 로 둠. 사유:
- FGIP2 Index 277 컬럼 중 Ex rating (Zone 1/2 / Class I Div ...) 이나 Ex 인증(IECEx / ATEX 인증 번호)을 정확히 담는 컬럼이 보이지 않음. `2_TAG CLASS` 는 계측기 분류(FT/LT 등)이라 의미가 다름. `89_F&G ZONE` 은 F&G 구획 정보로 Ex 등급과 구분됨.
- 사용자(실무자) 확인: "이 두 필드는 현재 중요한 항목 아님".
- 잘못된 컬럼을 억지로 매핑해 의미가 어긋난 데이터를 `public.tag` 에 채우는 것보다 NULL 이 정직.

적용 완료 후 `public.idx_backfill_tags(2)` 로 27,603 레코드에 대해 트리거 replay. 결과: `public.tag` 6,727 (ISS 복제분) → 27,608 (Index sync 포함), Index-only 태그 20,881개 신규.

## Consequences

**Good**
- 트리거 의존 로직(Drawings 모듈의 JB terminal·Loop diagram 등 향후 태그 참조)이 정확한 8개 필드로 동작.
- 매핑 결정이 `idx.index_column` 테이블 row 로 남아 DB-as-truth — 코드 변경 없이 컬럼 추가·변경 가능.
- `ex_rating` / `ex_certification` 이 NULL 이라는 사실 자체가 "Index 에 아직 이 데이터 없음" 의 증거가 됨 (누락 vs 명시적 부재 구분).

**Bad / 주의사항**
- 향후 Ex 필드 매핑이 필요해지면 `idx.index_column` 에 해당 행 UPDATE 후 `idx_backfill_tags()` 재실행해야 함 — 프로시저는 이미 있음, 런북에만 기록.
- 프로젝트마다 `.xlsb` 컬럼 명이 다를 수 있음. 신규 프로젝트 시드 시 동일한 리뷰 절차 반복 필요.
- 매핑 결정이 DB row 에 있으므로 코드 리뷰로는 보이지 않음. Cutover 런북 / onboarding 문서에서 "Phase 2 sync 직전 `is_tag_core` 리뷰" 스텝을 명시.

**Revisit 조건**: (a) Index 측에 Ex 등급/인증 컬럼이 신규 추가되거나, (b) Ex 데이터가 필요한 성과물(Wiring Diagram IS barrier 표시 등) 요구가 실제로 들어오면 매핑 추가.
