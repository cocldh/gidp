# GIDP — GS Instrument Data Platform

EPC 계장(Instrumentation) 데이터 라이프사이클 통합 플랫폼.  
**Master Index → Spec Sheet → 도면/리스트 산출물**까지 한 곳에서 관리합니다.

---

## 목차

1. [시작하기 — 계정 가입과 접속](#1-시작하기--계정-가입과-접속)
2. [화면 구조와 탐색](#2-화면-구조와-탐색)
3. [모듈 안내](#3-모듈-안내)
   - [Master Index](#master-index-idx)
   - [Spec Sheet (ISS)](#spec-sheet-iss)
   - [Drawings](#drawings)
4. [권한 구조](#4-권한-구조)
5. [Admin 기능](#5-admin-기능)
6. [개발 환경 셋업](#6-개발-환경-셋업)
7. [관련 문서](#7-관련-문서)

---

## 1. 시작하기 — 계정 가입과 접속

### 접속 URL

| 환경 | URL |
|---|---|
| 운영 | `https://gidp.com` (예정) |
| 로컬 개발 | `http://localhost:3000` |

모든 도구 앱(`/index`, `/iss`, `/drawings`)은 shell(`localhost:3000`)을 경유합니다.  
`localhost:3001` 등 포트 직접 접근은 일부 경로에서 동작하지 않을 수 있습니다.

### 가입 절차

1. 접속 URL에서 **이메일 + 비밀번호**로 회원가입
2. 가입 직후 상태는 **Pending** — 데이터에 접근할 수 없으며 "승인 대기" 안내 화면이 표시됩니다
3. Admin이 계정을 **Active**로 전환하고 프로젝트·모듈 권한을 배정해야 이용 가능합니다

### 로그인 흐름

```
로그인
  → 프로젝트 선택 (/project)
  → 도구 선택 대시보드 (/)
  → 원하는 모듈 진입
```

로그인 후 이전에 열려 있던 페이지가 있으면 `return_to` 파라미터로 자동 복귀합니다.

---

## 2. 화면 구조와 탐색

### 도구 선택 대시보드

로그인 후 프로젝트를 선택하면 나타나는 메인 화면입니다.  
사용자에게 접근 권한이 있는 모듈만 활성화(클릭 가능)되고, 권한이 없는 모듈은 "No Access"로 표시됩니다.

| 카드 | 설명 |
|---|---|
| Master Index | 프로젝트 전체 계장 Tag 마스터 (200+ 컬럼, Excel 업로드) |
| Spec Sheet (ISS) | Instrument Specification Sheet 작성·템플릿·리비전 관리 |
| Drawings | JB Wiring·Loop·Hook-up 도면 자동 생성 (DXF + PDF) |

### 프로젝트 전환

우상단 **프로젝트 변경** 버튼 → 프로젝트 선택 화면으로 이동.  
사용자가 배정된 프로젝트 목록만 표시됩니다.

### 로그아웃

우상단 **Sign Out** 버튼. 로그아웃 후 `/login`으로 이동합니다.

---

## 3. 모듈 안내

### Master Index (idx)

프로젝트의 **전체 계장 Tag 목록**을 관리하는 AG Grid 기반 스프레드시트입니다.

#### 주요 기능

| 기능 | 설명 | 필요 권한 |
|---|---|---|
| Tag 목록 조회 | 200+ 컬럼 가상 스크롤 그리드 | Viewer 이상 |
| Excel 필터 | 컬럼 헤더 클릭 → Excel 스타일 값 목록 필터 | Viewer 이상 |
| 컬럼 점프 | 검색창으로 원하는 컬럼 위치로 즉시 이동 | Viewer 이상 |
| 즐겨찾기(View) 저장 | 현재 숨김 컬럼 구성을 이름으로 저장·불러오기 | Viewer 이상 |
| 다크 모드 | 우상단 토글 | Viewer 이상 |
| 셀 인라인 편집 | 셀 클릭 후 직접 수정, Save 버튼으로 일괄 저장 | Editor 이상 |
| Undo | 마지막 편집 되돌리기 | Editor 이상 |
| 변경 이력 | ChangeLog 패널에서 수정 내역 확인 | Viewer 이상 |
| Excel 업로드 | `.xlsb` 파일로 Tag 일괄 import | Editor 이상 |
| CSV 다운로드 | 현재 그리드 내용 내보내기 | Viewer 이상 |

#### Tag 핀 고정

TAG NUMBER 컬럼은 항상 좌측에 고정됩니다. 수평 스크롤 시에도 Tag 번호를 확인할 수 있습니다.

#### 변경사항 저장

셀을 수정하면 하단 바에 **미저장 건수**가 표시됩니다. **Save** 버튼을 눌러야 DB에 반영됩니다.  
저장 전에 페이지를 이탈하면 변경사항이 사라집니다.

---

### Spec Sheet (ISS)

계장 Tag별 **Instrument Specification Sheet**를 작성·관리하는 모듈입니다.

#### 주요 기능

| 기능 | 설명 | 필요 권한 |
|---|---|---|
| Tag 목록 조회 | ISS가 작성된 Tag 및 미작성 Tag 목록 | Viewer 이상 |
| ISS 조회 | 특정 Tag의 Spec Sheet 열람 | Viewer 이상 |
| ISS 작성/편집 | 필드 값 입력, 드롭다운 매핑 선택 | Editor 이상 |
| 리비전 관리 | 문서 개정 이력 조회, 새 리비전 생성 | Editor 이상 |
| 템플릿 관리 | 기기 유형별 필드 구성 설정 | ISS Admin 이상 |
| 필드 정의 관리 | 필드 메타(라벨, 타입, 매핑 등) 편집 | ISS Admin 이상 |

#### 미작성 Tag 동작

Master Index에 있지만 ISS 문서가 없는 Tag는 목록에서 "No documents"로 표시됩니다.  
이는 정상 동작입니다(ISS 대상이 아닌 Tag일 수 있음).

---

### Drawings

JB Wiring·Loop·Hook-up 도면을 **자동 생성**하는 모듈입니다. (Phase 3 개발 예정)

| 기능 | 설명 | 필요 권한 |
|---|---|---|
| Junction Box / Cable / Terminal 관리 | 배선 정보 입력 | Editor 이상 |
| 도면 인스턴스 생성 | 템플릿 기반 도면 자동 생성 요청 | Editor 이상 |
| 도면 조회·다운로드 | DXF / PDF 출력물 열람 | Viewer 이상 |
| 도면 리비전 관리 | 개정 이력 추적 | Editor 이상 |

---

## 4. 권한 구조

GIDP 권한은 **전역 역할 → 프로젝트 역할 → 모듈 접근** 3단계로 구성됩니다.

### 전역 역할 (GlobalRole)

모든 사용자는 하나의 전역 역할을 가집니다.

| 역할 | 설명 |
|---|---|
| **Pending** | 가입 직후 기본값. Admin 승인 전까지 데이터 접근 불가 |
| **Active** | 정상 활성 사용자. 아래 프로젝트/모듈 역할로 세분화 |
| **Admin** | 시스템 전체 관리자. 모든 프로젝트·모듈에 무조건 접근 |

### 프로젝트 역할 (ProjectRole)

Active 사용자가 특정 프로젝트에 배정될 때 부여됩니다.  
**모듈별 접근 행이 없으면 이 역할이 모듈 접근의 기본값**으로 사용됩니다.

| 역할 | 데이터 읽기 | 데이터 쓰기 | 멤버 관리 |
|---|---|---|---|
| **Viewer** | 가능 | 불가 | 불가 |
| **Editor** | 가능 | 가능 | 불가 |
| **ProjectAdmin** | 가능 | 가능 | 가능 (이 프로젝트 한정) |

### 모듈 접근 (ModuleAccess)

`iss` / `idx` / `drawings` 모듈별로 별도 접근 레벨을 지정할 수 있습니다.  
예: ISS는 Viewer, Index는 Editor로 다르게 설정 가능.

| 레벨 | 읽기 | 쓰기 | 모듈 설정 |
|---|---|---|---|
| **None** | 불가 | 불가 | 불가 |
| **Viewer** | 가능 | 불가 | 불가 |
| **Editor** | 가능 | 가능 | 불가 |
| **Admin** | 가능 | 가능 | 가능 |

### 권한 판별 순서

```
1. Admin?          → 전체 허용 (나머지 체크 없음)
2. Pending?        → 전면 차단
3. Active
   ├─ 모듈별 행 있음? → ModuleAccess 적용
   └─ 없음           → ProjectRole로 fallback
```

### 화면 접근 가드 요약

| 상황 | 결과 |
|---|---|
| 미로그인 상태로 보호 경로 접근 | `/login?return_to=...` 리다이렉트 |
| 로그인했으나 프로젝트 미선택 | `/project` 리다이렉트 |
| Pending 상태로 로그인 | `/pending` 안내 화면 |
| 모듈 접근 권한 없음 | 도구 카드 "No Access" 표시 (클릭 불가) |

---

## 5. Admin 기능

Admin 역할 사용자는 우상단 **Admin** 버튼으로 관리 화면에 진입합니다 (`/iss/admin`).

### 사용자 관리

- 전체 사용자 목록 조회
- 전역 역할 변경 (Pending → Active / Admin)
- 사용자명(username)·표시 이름(display name) 편집
- 프로젝트 역할 배정·해제

### 프로젝트 관리

- 신규 프로젝트 생성 (프로젝트 코드 형식: `e230350` 또는 `p230351`)
- 프로젝트 정보 편집

### 필드 정의 관리

- ISS 필드 메타 편집 (라벨, 타입, 드롭다운 옵션 등)

### ISS 병합

- 여러 Template 또는 문서를 병합하는 고급 기능

---

## 6. 개발 환경 셋업

### 전제 조건

- Node.js 20+ (현재 확인: v24)
- pnpm (corepack으로 활성화 권장)
- Git

### 설치

```bash
corepack enable
corepack prepare pnpm@latest --activate
cd gidp
pnpm install
```

### 개발 서버 실행

```bash
pnpm dev   # shell(3000) + iss(3001) + index(3002) 동시 기동
```

포트 충돌 시:

```bash
netstat -ano | grep ":300"
```

### 빌드·검증

```bash
pnpm build       # 전체 빌드
pnpm type-check  # TypeScript 타입 검사
pnpm lint        # ESLint
```

### 로그인 smoke test

```bash
for p in "/login" "/" "/project" "/iss" "/index"; do
  curl -s -D - -o /dev/null "http://localhost:3000$p" | head -3
done
```

### Python 서비스 환경 (Phase 3 이후)

`services/drawing-gen`은 Python 3.11+ FastAPI. 캐시/venv는 D 드라이브 고정.

```powershell
# 최초 1회 설정
setx PIP_CACHE_DIR "D:\pip-cache"
setx UV_CACHE_DIR  "D:\uv-cache"
```

```bash
cd services/drawing-gen
python -m venv .venv
.venv/Scripts/activate
pip install -e .
```

---

## 7. 관련 문서

| 파일 | 용도 |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | 개발자·AI 공용 작업 가이드 (컨벤션, 아키텍처 규칙) |
| [PLAN.md](./PLAN.md) | Phase 0~6 로드맵, 데이터 이관 계획 |
| [docs/architecture.md](./docs/architecture.md) | 고수준 아키텍처 (Multi-Zones, DB 모델, 인증 흐름) |
| [docs/adr/](./docs/adr/) | 주요 아키텍처 결정 기록 (ADR) |
