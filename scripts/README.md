# GIDP ops scripts

일회성·정기 ops 스크립트 모음. 현재는 ISS 레거시 DB → GIDP 스냅샷 복제만.

## 초기 셋업

```bash
# 모노레포 루트에서
pnpm install
```

`scripts/.env.local` 을 만들고 두 Supabase 프로젝트의 direct PG 연결 문자열을 채웁니다.
`.env.example` 참고. Dashboard > Project Settings > Database > Connection string > URI 에서 복사.

> **주의**: Transaction mode pooler(port 6543)는 prepared statement 제약이 있어 이 스크립트와 맞지 않습니다.
> Direct connection(5432) 또는 Session mode pooler 를 사용하세요.

## ISS 스냅샷 복제

```bash
# 1단계: dry-run — 실제 쓰기 없이 source row count 만 확인
pnpm --filter @gidp/scripts snapshot:iss:dry

# 2단계: 실제 복제
pnpm --filter @gidp/scripts snapshot:iss
```

동작:

- 원본: `lyqsabfezsmapbzdnlko.e230350.*` (FGIP2 프로젝트 실데이터)
- 대상: `crtsgykvmowpxqfqchgy` 의 `public.tag` + `iss.*`, 전부 `project_id=2` 부여
- 원본 pk 값을 유지한 채 insert → sequence setval 로 다음 insert 안전성 확보
- 모든 insert 는 `ON CONFLICT DO UPDATE` — 재실행 안전(멱등)
- 원본 연결은 트랜잭션 read-only 로 강제 (기존 시스템에 어떤 쓰기도 발생하지 않음)

복제 순서 (FK 의존성):

1. `public.tag`
2. `iss.template` → `iss.field_def` → `iss.mapping_rule` → `iss.mapping_option`
3. `iss.document` → `iss.document_value`
4. `iss.document_revision` → `iss.document_revision_detail`
5. `iss.document_value_change`

## 재동기화 정책

Phase 1~5 기간 중 원본 ISS 가 계속 read-write 로 운영되므로 스냅샷은 **Day 0 snapshot**입니다.
필요 시 재실행하면 멱등하게 delta 반영되지만, 복제 이후 GIDP 측에서 편집한 레코드는
`ON CONFLICT DO UPDATE` 로 덮어씌워지니 주의.
