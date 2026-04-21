# ISS Web

Next.js와 Supabase 기반의 웹 ISS(Instrument Specification Sheet) 관리 시스템입니다.

---

## 기술 스택

- **프론트엔드**: Next.js (App Router), Tailwind CSS
- **백엔드 / DB**: Supabase (PostgreSQL)
- **배포**: Vercel

---

## 권한(Role) 체계

권한은 **전체(Global) 역할**과 **프로젝트(Project) 역할** 두 단계로 구성됩니다.

### 전체(Global) 역할 — `user_profile.role`

| 역할 | 설명 |
|------|------|
| **Admin** | Global Admin — 모든 프로젝트 + 사용자 관리 전부 가능 |
| **Active** | 일반 사용자 — 프로젝트별 역할이 실제 권한을 결정 |
| **Pending** | 승인 대기 — 모든 기능 차단 |

### 프로젝트(Project) 역할 — `user_project_role.role`

| 역할 | 설명 |
|------|------|
| **ProjectAdmin** | 해당 프로젝트 Form·Field 관리 가능. User Management 불가 |
| **Editor** | 데이터 편집 + Change Log 접근 |
| **Viewer** | 조회/검색만 가능 (읽기 전용) |

> Active 사용자는 프로젝트에 역할이 없으면 해당 프로젝트에 접근 불가.
> Global Admin은 `user_project_role` 없어도 모든 프로젝트에 완전한 접근 가능.

### 기능별 접근 권한

| 기능 | Viewer | Editor | ProjectAdmin | Admin(Global) |
|------|:------:|:------:|:------------:|:-------------:|
| 대시보드 — 태그 검색 | O | O | O | O |
| 대시보드 — 폼 필드 조회 | O | O | O | O |
| 브라우저 — Total / Form 뷰 | O | O | O | O |
| 브라우저 — CSV 내보내기 | O | O | O | O |
| 대시보드 — 필드 값 편집 | | O | O | O |
| 대시보드 — ISS Form 생성 (.xlsx) | | O | O | O |
| 대시보드 — Minor / Major Revision 커밋 | | O | O | O |
| 브라우저 — 셀 인라인 편집 | | O | O | O |
| Change Log 조회 (`/changelog`) | | O | O | O |
| Forms — 템플릿 매핑 조회/삭제 | | | O | O |
| Admin — 필드 병합 (`/admin/merge`) | | | O | O |
| Change Log — Set Baseline | | | | O |
| Admin — 기본 필드 관리 (`/admin/fields`) | | | | O |
| Admin — 프로젝트 관리 (`/admin/projects`) | | | | O |
| Admin — 사용자 관리 (`/admin/users`) | | | | O |

---

## 페이지 설명

### `/dashboard` — 태그 검색

- **Tag Number**, **Document Number**, **Item** 값으로 검색 가능
- 검색 결과는 태그 기준으로 그룹화, Document Number 순 정렬
- 컬럼: Tag Number / Document (Sheet 포함, 예: `DOC-001-003`) / Template / Item
  - Template 컬럼: `template_name`이 있으면 `"SA-8020-712 - Instrument Specification Sheet"` 형태로 표시
- 태그 클릭 시 해당 태그의 폼 뷰로 이동

### `/dashboard/[tagId]` — 폼 뷰

- 좌측 패널: 해당 태그에 속한 Document 목록
  - 현재 Revision 표시: `revision_number + minor_revision` 합산값 (예: `Aa`, `Ab`, `B`)
  - Document 아래 Template 표시: `template_name`이 있으면 `"코드 - 이름"` 형태
- 우측 패널: 선택한 Document의 필드 값
  - 해당 Document의 Template에 매핑된 필드(`mapping_rule`)만 표시
  - 필드 정렬: 주요 필드(Item, Tag Number, Service 등) → 일반 필드 → Note 마지막
  - Note 필드는 15줄 텍스트 영역으로 표시
  - Sheet Number는 3자리 zero-padding으로 표시 (예: `3` → `003`)
- Editor 이상: 필드 값 편집, 필드 순서 변경, ISS Form 생성 (.xlsx)
- **변경 하이라이트**: 변경된 필드는 노란색(`bg-yellow-50`) 강조, 필드 아래 이전 값 표시
  - **Minor Revision (Save Changes)**: 이번 저장에서 변경된 필드만 하이라이트 (이전 Minor 하이라이트 교체)
  - **Major Revision 커밋**: 하이라이트 유지 — 이전 Major 이후 변경된 모든 필드가 계속 표시됨
  - **Set Baseline**: 모든 하이라이트 초기화
- **Minor Revision 자동 처리**: Save Changes 실행 시 변경 필드가 있으면 `minor_revision` 자동 증가 (a→b→c…), `document_revision` + `document_revision_detail` 레코드 자동 생성
- **Major Revision 커밋**: 툴바의 **Major Revision 커밋** 버튼 (Editor 이상, Document 로드 시 항상 활성화). Document Number 선택 → 대상 Sheet 미리보기 → 새 Revision 번호 입력 → 동일 `document_number`의 모든 Sheet 일괄 처리, `minor_revision` NULL 초기화
- **Revision History**: 현재 Document의 리비전 커밋 이력 조회 패널. 각 항목 클릭 시 변경 필드 상세 표시 (이전값 → 새값)

### `/browser` — 브라우저 뷰

- **Total Browser**: 전체 문서 조회 (템플릿 필터 선택 가능)
- **Form Browser**: 선택한 템플릿의 문서만 조회, 해당 템플릿의 매핑 필드만 표시 (템플릿 선택 필수)
  - 템플릿 드롭다운: `template_name`이 있으면 `"SA-8020-712 - Instrument Specification Sheet"` 형태로 표시
- **Rev 컬럼**: `revision_number + minor_revision` 합산값 표시 (예: `Aa`)
- 각 컬럼 헤더 아래 필터 입력창 (실시간 클라이언트 필터링)
- Note 컬럼: 3줄 텍스트 영역
- 페이지네이션 (50 / 100 / 200 / 500 행)
- Editor 이상: 셀 인라인 편집, ISS Form 생성 (.xlsx / .zip)
- CSV 내보내기

### `/changelog` — 전체 변경 이력 *(Editor, Admin)*

- `document_revision_detail` 기반 전체 필드 변경 이력 조회
- **필터**: Document Number, Tag Number, 필드명, 작성자, 날짜 범위
- 표시 컬럼: 날짜/시각 | Document | Tag | 필드명 | 이전 값 | 새 값 | Rev (배지) | Type | 작성자
- 100건씩 페이지네이션
- 이력은 영구 보관 (커밋으로 삭제되지 않음)
- **Set Baseline** *(Admin 전용)*: 우측 상단 버튼. 현재 상태를 새 기준점으로 선언하며 전체 변경 추적(`document_value_change`) 초기화. 확인 후 실행

### `/forms` — Form 관리 *(ProjectAdmin, Admin)*

- 전체 템플릿 목록 및 각 템플릿의 `mapping_rule` 확인
- 템플릿 코드 아래 `template_name` 표시 (설정된 경우)
- **Edit** 버튼으로 `template_name` 인라인 편집 가능 (Enter로 저장, Esc로 취소)
- 템플릿 삭제, 개별 매핑 규칙 삭제

### `/admin/users` — 사용자 관리 *(Global Admin 전용)*

- 승인 대기(Pending) 사용자 목록 — Approve / Reject 버튼
- 전체 사용자 목록 (email, display name, username, Global Role, 가입일)
  - **Display Name** 인라인 편집: 셀 hover 시 ✎ 버튼 표시
  - **Username** 인라인 편집: 셀 hover 시 ✎ 버튼 표시 (영문·숫자·언더바만 허용, 중복 불가)
- 사용자별 Global 역할 변경 (Active / Admin / Pending) 드롭다운
- 사용자 삭제 (Remove 버튼) — Supabase auth.users까지 완전 삭제
- **프로젝트 역할 할당** — 사용자 행 클릭 시 하단 패널 활성화
  - 현재 할당된 프로젝트 역할 목록 (프로젝트명, 역할, 할당일)
  - 역할 변경 드롭다운 (ProjectAdmin / Editor / Viewer)
  - 역할 제거 (Remove 버튼)
  - 새 프로젝트 역할 추가 (프로젝트 선택 + 역할 선택 + Assign 버튼)

### `/admin/fields` — 기본 필드 관리 *(Global Admin 전용)*

- `public.default_field_def` 테이블 관리
- 새 프로젝트 생성 시 자동으로 복사될 기본 필드 목록 확인 및 편집
- 필드 추가 (field_name, data_kind, display_order)
- display_order 인라인 수정 (포커스 아웃 시 자동 저장)
- 필드 삭제

### `/admin/projects` — 프로젝트 관리 *(Global Admin 전용)*

- 신규 프로젝트 생성 폼 (Project Code, Project Name, Description)
  - Project Code: 소문자·숫자·언더바만 허용 (PostgreSQL 스키마명으로 사용)
  - 생성 시 `fn_create_project_schema` RPC 호출 → 스키마 + 테이블 자동 설정
- 등록된 전체 프로젝트 목록 (Code, Name, Description, 생성일)
- 새 프로젝트 생성 후 Supabase **Settings → API → Exposed schemas**에 해당 project_code 추가 필요

### `/admin/merge` — 필드 병합 *(ProjectAdmin, Admin)*

- 중복된 `field_def` 항목(소스)을 다른 필드(타겟)로 병합
- 소스 필드의 모든 `document_value` 및 `mapping_rule`이 타겟으로 이전된 후 소스 필드 삭제

---

## 로컬 개발 환경 설정

```bash
# 1. 클론
git clone https://github.com/cocldh/iss-web.git
cd iss-web

# 2. 패키지 설치
npm install

# 3. 환경변수 설정 (.env.local 직접 작성 또는 Vercel CLI로 가져오기)
vercel env pull .env.local

# 4. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

### `.env.local` 필수 항목

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
RESEND_API_KEY=re_...          # 이메일 알림용 (선택)
ADMIN_EMAIL=admin@example.com  # 신규 가입 알림 수신 (선택)
```

### 배포

`main` 브랜치에 push하면 Vercel 자동 배포.
수동 배포:

```bash
vercel --prod --yes
```

---

## 프로젝트 구조

```
src/
├── app/
│   ├── page.tsx                       # 루트 리다이렉트
│   ├── login/page.tsx                 # 로그인 / 회원가입
│   ├── pending/page.tsx               # 승인 대기 페이지
│   ├── project/page.tsx               # 프로젝트 선택 (쿠키 저장)
│   ├── dashboard/
│   │   ├── page.tsx                   # 태그 검색 (TagList)
│   │   └── [tagId]/page.tsx           # 폼 뷰
│   ├── browser/page.tsx               # 브라우저 뷰
│   ├── changelog/page.tsx             # 전체 변경 이력 (Editor+)
│   ├── forms/page.tsx                 # Form 관리 (ProjectAdmin+)
│   ├── admin/
│   │   ├── users/page.tsx             # 사용자 관리 + 프로젝트 역할 할당 (Admin)
│   │   ├── merge/page.tsx             # 필드 병합 (ProjectAdmin+)
│   │   ├── fields/page.tsx            # 기본 필드 관리 (Admin)
│   │   └── projects/page.tsx          # 프로젝트 생성 및 목록 (Admin)
│   └── api/
│       ├── generate/route.ts          # ISS Form 생성 API
│       ├── column-order/route.ts      # 컬럼 순서 설정 API
│       ├── auth/
│       │   ├── lookup-email/          # username → email 조회 (로그인용)
│       │   ├── save-username/         # 회원가입 시 username 저장
│       │   └── check-role/            # 역할 확인 API (RLS 우회, pending 페이지용)
│       └── admin/
│           ├── create-project/        # 프로젝트 생성 (fn_create_project_schema RPC)
│           ├── delete-user/           # 사용자 완전 삭제 (auth.users 포함)
│           ├── update-username/       # username 수정 (Admin 전용)
│           └── update-display-name/   # display name 수정 (Admin 전용)
├── components/
│   ├── Navbar.tsx                     # 역할 기반 네비게이션 메뉴
│   ├── RoleGuard.tsx                  # 권한 기반 접근 제어 (useUserRole 훅 포함)
│   ├── TagList.tsx                    # 태그 검색 및 결과 표시
│   ├── DocumentFields.tsx             # 폼 뷰 필드 편집기 (Minor/Major Revision 포함)
│   └── BrowserTable.tsx               # 브라우저 테이블 (필터 포함)
└── lib/
    ├── supabase-client.ts             # 브라우저 클라이언트 + 스키마 클라이언트
    ├── supabase-server.ts             # 서버 클라이언트 (쿠키 기반)
    ├── supabase-admin.ts              # Service Role Key 사용 (서버 전용, RLS 우회)
    └── types.ts                       # GlobalRole, ProjectRole, UserProjectRole 등
```

---

## 권한별 기능 요약

### Viewer (읽기 전용)
- 태그 검색 및 폼 뷰 조회
- 브라우저 뷰 조회 (Total / Form)
- CSV 내보내기
- Revision History 조회

### Editor (편집 가능)
- Viewer의 모든 기능
- 폼 뷰에서 필드 값 편집 및 저장
- 필드 표시 순서 변경
- ISS Form (.xlsx) 생성 및 다운로드
- 브라우저 뷰 셀 인라인 편집
- **Minor Revision 자동 커밋** — Save Changes 시 자동 처리 (a→b→c…)
- **Major Revision 커밋** — 동일 document_number의 모든 Sheet 일괄 처리
- **Change Log** 조회 (`/changelog`) — 전체 필드 변경 이력 열람

### ProjectAdmin (프로젝트 관리자)
- Editor의 모든 기능
- 템플릿 및 매핑 규칙 관리 (`/forms`)
- 중복 필드 병합 (`/admin/merge`)

### Admin — Global Admin (전체 관리자)
- ProjectAdmin의 모든 기능
- **Set Baseline** — Change Log 우측 상단에서 전체 변경 추적 초기화
- 사용자 관리 + 프로젝트 역할 할당 (`/admin/users`)
- 기본 필드 관리 (`/admin/fields`) — 새 프로젝트 생성 시 자동 복사될 필드 설정
- 프로젝트 생성 및 관리 (`/admin/projects`) — 스키마·테이블 자동 설정
