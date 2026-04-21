# Architecture Decision Records

주요 아키텍처 결정을 번호순으로 기록. 각 ADR은 불변 — 결정이 뒤집히면 **새 ADR**을 작성하고 기존 ADR의 Status를 "Superseded by NNNN"으로만 업데이트.

형식: **Context / Decision / Consequences** (각 1~3문단, 과도하게 길지 않게).

## Index

| # | 제목 | Status |
|---|---|---|
| [0001](./0001-multi-zones.md) | Multi-Zones vs Subdomain Federation | Accepted |
| [0002](./0002-single-db-project-id.md) | Schema-per-project 폐기, 통합 + project_id + RLS | Accepted |
| [0003](./0003-project-code-format.md) | Project code 포맷 `^[ep]\d{6}$` | Accepted |
| [0004](./0004-path-only-return-to.md) | `return_to`에 same-origin path-only 수용 | Accepted |
| [0005](./0005-index-data-import-via-xlsb-upload.md) | Index 초기 데이터는 `.xlsb` 업로드로 이관 (스냅샷 스크립트 불필요) | Accepted |
| [0006](./0006-is-tag-core-mapping.md) | `is_tag_core` 매핑: Index 8개 컬럼만 sync, Ex 필드 유보 | Accepted |
