# GIDP — GS Instrument Data Platform

EPC 계장(Instrumentation) 데이터 라이프사이클 통합 플랫폼. Master Index → Spec Sheet → 도면/리스트 산출물까지 한 곳에서 관리.

## 구성

- `apps/iss` — Instrument Specification Sheet (Phase 1에 `../ISS/iss-web`에서 subtree 복사)
- `apps/index` — Master Instrument Index (Phase 1에 `../Index`에서 subtree 복사)
- `apps/drawings` — Wiring/Loop/Hook-up 도면 UI (Phase 3 신규)
- `services/drawing-gen` — Python FastAPI (ezdxf + reportlab) 도면 생성 서비스 (Phase 3)
- `packages/ui` — 공통 React 컴포넌트
- `packages/auth` — Supabase SSR + RBAC 공용 레이어
- `packages/db` — Supabase 생성 타입 + 쿼리 헬퍼
- `packages/domain` — zod 스키마 (Tag/Loop/Cable/JB/Terminal …)
- `packages/config` — tsconfig/eslint/tailwind 공용 preset
- `supabase/` — 단일 통합 스키마 migrations
- `scripts/` — 기존 ISS/Index Supabase → GIDP 스냅샷 복제 스크립트

## 병행 운영 원칙

GIDP 완성(Phase 6 Cutover) 전까지 기존 `../ISS`, `../Index` 및 각 Supabase는 **그대로 유지**. GIDP는 별도 Supabase 프로젝트 + 별도 도메인으로 독립 개발. 초기 데이터는 Day 0 스냅샷 단방향 복제만 수행 — 기존 시스템에 쓰기 없음.

## 개발 환경 셋업

### 전제
- Node.js 20+ (현재 확인: v24)
- Git
- pnpm (corepack으로 활성화 권장)

### pnpm 활성화
```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

### 의존성 설치
```bash
cd gidp
pnpm install
```

### 빌드/테스트
```bash
pnpm build       # turbo run build
pnpm lint        # turbo run lint
pnpm type-check  # turbo run type-check
pnpm dev         # 모든 apps 동시 기동
```

### Python 서비스 환경 (Phase 3 이후)

`services/drawing-gen` 은 Python 3.11+ FastAPI. **모든 캐시/venv 는 D 드라이브에 고정** (C 용량 절약).

- pip 캐시: `D:\pip-cache`  (환경변수 `PIP_CACHE_DIR`)
- uv 캐시: `D:\uv-cache`    (환경변수 `UV_CACHE_DIR`)
- venv: 각 서비스 폴더 안의 `.venv` (예: `services/drawing-gen/.venv`) — 프로젝트가 D에 있으므로 자동으로 D

최초 1회 설정 (PowerShell/cmd):
```
setx PIP_CACHE_DIR "D:\pip-cache"
setx UV_CACHE_DIR  "D:\uv-cache"
```

venv 생성 (서비스 폴더 안에서):
```bash
cd services/drawing-gen
python -m venv .venv
.venv/Scripts/activate   # Windows
pip install -e .
```

**주의**: Python 자체를 새로 설치할 때는 installer에서 설치 경로를 `D:\Python311\` 등으로 지정해야 함. 기본값은 `C:\Users\...\AppData\Local\Programs\Python`.

## 전체 계획

세부 Phase 계획은 [PLAN.md](./PLAN.md) 참조.

현재 Phase: **Phase 0 (Monorepo Skeleton)**.
