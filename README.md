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

#### Excel 업로드 상세 동작

우상단 **Upload** 버튼으로 `.xlsx` / `.xlsb` / `.csv` 파일을 가져올 수 있습니다.

**처리 순서**

1. 파일의 첫 번째 시트를 읽어 JSON 배열로 파싱합니다.
2. 파일 헤더(컬럼명) 중 DB에 없는 항목을 `idx.index_column`에 신규 추가합니다. 기존 컬럼은 건드리지 않습니다.
3. 현재 프로젝트의 `TAGNUMBER → record ID` 매핑을 DB에서 조회합니다.
4. 파일의 각 행을 아래 기준으로 분류해 처리합니다.

| 엑셀 행 | DB 상태 | 결과 |
|---|---|---|
| TAGNUMBER가 DB에 **있음** | 기존 record | 해당 row의 `data` 전체를 엑셀 값으로 **교체** |
| TAGNUMBER가 DB에 **없음** | 신규 | **새 record 삽입** |
| 엑셀에 **없는** TAGNUMBER | DB에만 존재 | **변경 없음** (삭제되지 않음) |

5. 처리는 200행 단위 배치로 진행되며, 진행률 바가 실시간으로 표시됩니다.
6. 완료 후 삽입/업데이트 건수가 요약으로 표시됩니다.

**주의사항**

- 업로드는 **Change Log에 기록되지 않습니다.** 셀 인라인 편집과 달리, 업로드로 변경된 내용은 Change Log 패널에 표시되지 않습니다.
- 기존 row가 업데이트될 때 실제로 값이 바뀐 컬럼만 선택적으로 갱신하는 것이 아니라, 해당 row의 **모든 필드**가 엑셀 값으로 한 번에 교체됩니다.
- 엑셀에 포함되지 않은 Tag는 DB에서 삭제되지 않습니다. 특정 Tag만 수정한 엑셀을 올려도 나머지 Tag는 그대로 유지됩니다.

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

도면·리스트 산출물을 **자동 생성**하는 모듈입니다. 현재 베타로 제공되는 것은 **IIS (Instrument Installation Schedule)** 생성기이며, JB Wiring · Loop · Hook-up 도면(DXF/PDF)은 Phase 3 이후 단계입니다.

진입: GIDP 홈 → **Drawings** 카드 → IIS 서브메뉴 3 개 (Column Mapping / Classification Rules / Generation).

#### IIS (Instrument Installation Schedule)

Aramco 표준 SA-xxxx 시리즈 폼에 프로젝트의 Tag 데이터를 자동으로 stamp 해서 `.xlsx` 산출물을 만드는 도구입니다. Master Index 의 컬럼과 ISS Spec Sheet 의 필드 값을 끌어와서 템플릿의 정해진 위치에 채워 넣는 방식이며, 사람이 수기로 옮기던 작업을 일괄 자동화합니다.

##### 워크플로 한눈에

```
[1] Column Mapping        [2] Classification Rules        [3] Generation
─────────────────────     ─────────────────────────       ────────────────
어떤 컬럼/필드를          어떤 Tag 를                     실제로 xlsx 생성.
어디(템플릿 어느 열)에    어떤 템플릿으로                 Single / All /
넣을지 정의              라우팅할지 정의                 Auto 3 가지 모드
(프로젝트 단위)          (프로젝트 단위)                
```

##### 1) Column Mapping (`/drawings/iis/mapping`)

각 IIS 템플릿의 **출력 컬럼(엑셀 열)** 을 어떤 데이터 소스에 연결할지 정의하는 화면입니다. 매핑은 **현재 프로젝트에만** 적용되며, 프로젝트가 바뀌면 다시 정의해야 합니다.

| 항목 | 의미 |
|---|---|
| Template | SA-2781A / SA-2781B / ... 등 IIS 템플릿 코드. 좌측 패널에서 선택 |
| Output column letter | 템플릿 엑셀의 출력 열 (A, B, C, …) |
| Output label | 헤더 행에 표시될 라벨 (MERGED.xlsx 에 반영) |
| Source — IDX column | Master Index 컬럼 1 개 또는 여러 개를 **concatenation** 으로 합쳐 사용 |
| Source — ISS field | ISS Spec Sheet 의 필드 값을 가져옴 |
| Source — Constant | 고정 텍스트 (예: "AS PER P&ID") |
| Concat separator | IDX 컬럼 여러 개일 때 사이에 들어갈 구분자 (기본 공백) |
| Transform | `UPPER` / `LOWER` / `decimal:N` (소수점 N 자리 반올림) |
| Display order | 같은 템플릿 안에서의 표시·매핑 순서 |

**저장 동작.** Mapping 은 `iis_column_mapping` 테이블에 (project_id, template_code, output_column_letter) 단위로 저장됩니다. 동일 키가 있으면 덮어쓰기됩니다.

##### 2) Classification Rules (`/drawings/iis/classification`)

각 Tag 를 **어떤 템플릿으로 보낼지** 결정하는 라우팅 규칙입니다. Auto 모드와 All 모드에서 사용됩니다.

**Function key (FK).** Tag number 의 끝에서 두 번째 hyphen segment 가 function key 입니다.

```
D44-403-PI-2781   →  fk = PI
D44-403-PZV-1234  →  fk = PZV
D46-632-PT-0038   →  fk = PT
```

이 FK 를 룰의 `match_value` 와 대조해서 템플릿 코드를 결정합니다.

| 룰 컬럼 | 의미 |
|---|---|
| Template code | 매칭 시 라우팅될 IIS 템플릿 |
| Match kind | `prefix` (FK 가 match_value 로 시작) 또는 `regex` (정규식) |
| Match value | 비교 대상 문자열 |
| Priority | 정수. **낮을수록 먼저** 적용. 같은 priority 면 match_value 가 **긴 것** 이 먼저 |
| Is active | OFF 면 평가에서 제외 |

**평가 순서.**

1. 모든 active 룰을 priority ASC, match_value 길이 DESC 로 정렬
2. 위에서부터 차례로 FK 와 비교, **가장 먼저** 매칭되는 룰의 template 채택
3. 어떤 룰도 매칭되지 않으면 → UNCLASSIFIED 로 분류 (Auto 모드의 경우 `UNCLASSIFIED.csv` 로 별도 출력)

**주의 — Classification 은 Loop Number 유무를 보지 않습니다.**

분류는 오직 function key 문자열만 기준으로 합니다. 예를 들어 `prefix='P'` 룰 하나로 SA-2781A 를 설정하면 **`P` 로 시작하는 모든 FK** 가 거기로 라우팅됩니다 — Loop Number 가 있는 Pressure Indicator 도, Loop Number 가 없는 Pressure Gauge 도, PT · PCV · PDI 도 전부 한 템플릿에 들어갑니다. 더 좁은 분류가 필요하면 더 긴 prefix (예: `PZV`) 를 별도 룰로 추가하고 priority 를 낮게 설정해서 우선 매칭되게 합니다 (예: `PZV` priority=300 < `P` priority=310 → PZV 만 SA-2799 로 분리).

> **현재 FGIP2 (project_id=2) 의 예.** `prefix='P'` → SA-2781A 한 줄로 잡혀 있어서 PI (1865개) · PT (535) · PCV (118) · PDI (275) 등 P-시작 FK 전부가 SA-2781A 시트로 모입니다. 그중 PZV (398) 만 별도 룰 (priority 300) 로 SA-2799 로 빠집니다. 시각적으로 Local gauge 와 Loop instrument 를 구분하려면 정렬 순서(아래) 에 의존해야 합니다.

##### 3) Generation (`/drawings/iis/generate`)

실제 xlsx 산출물을 만드는 화면입니다.

**Target (필수).**

| 모드 | 동작 | 산출물 |
|---|---|---|
| **Single template** | 좌측에서 템플릿 1 개 선택 → 그 템플릿에 해당하는 모든 태그를 stamp. Classification rule 이 있으면 그 룰로 필터된 태그만 사용 (legacy: 룰이 없으면 전체 태그) | `{template}_pageNNN-of-MMM.xlsx` 페이지 + `{template}_MERGED.xlsx` 합본 → ZIP |
| **Auto** | 모든 룰을 적용해서 모든 active 템플릿을 **한 번에** 생성 | 템플릿별 폴더 + `UNCLASSIFIED.csv` + `SUMMARY.txt` → ZIP |

**Options.**

| 옵션 | 동작 |
|---|---|
| Loop mid letter | 비워두면 전체. `P` / `T` / `F` / `L` / `A` 선택 시 Loop Number 의 세 번째 segment 가 그 글자로 시작하는 태그만 추림. **빈 Loop Number (Local gauge) 는 이 필터에 걸리면 제외됨** — Local 까지 같이 받으려면 "전체" 로 두기 |
| Revision No. | 비우면 건드리지 않음. 값을 넣으면 템플릿의 `REV_NUMBER` placeholder 와 `rev_no_cells` 매핑에 stamp |
| Document No. (DCC No.) | 비우면 건드리지 않음. 값을 넣으면 `DCC_NO` placeholder 와 `doc_no_cell` 매핑에 stamp |

**Header placeholder 동작.**

각 페이지의 시트 번호 / 리비전 / DCC 번호는 두 가지 방식으로 stamp 됩니다.

1. **iis_template_layout 의 셀 주소 매핑** (`page_no_cell` / `rev_no_cells` / `doc_no_cell`) — DB 에 직접 좌표가 지정된 곳에 채움
2. **Excel placeholder 매칭** — 셀의 텍스트나 **Name Box (Defined Name)** 가 다음 문자열과 일치하면 거기에 채움.
   - `SHEET_NUMBER` — exact match. 페이지 번호 (001/002/...) 가 들어감
   - `DCC_NO` — exact match. 사용자가 입력한 Document No. 가 들어감
   - `REV_NUMBER` — **contains match.** `REV_NUMBER`, `REV_NUMBER1`, `RV_REV_NUMBER` 처럼 그 문자열을 **포함하는** 모든 이름·셀에 동시 stamp (Aramco 폼은 페이지당 여러 개 rev slot 이 있음)

placeholder 가 병합 셀 안에 있으면 자동으로 anchor (좌상단) 셀로 redirect 됩니다 (그렇지 않으면 Excel 이 "We found a problem with some content" 경고를 띄움).

**Tag 정렬 순서.** Generation 결과의 행 순서는 다음 기준으로 정렬됩니다 (DB SQL 단계에서 정해짐).

```
1순위: Loop Number ASC (NULLS FIRST + 빈 문자열도 NULL 취급)
2순위: Internal Loop Order ASC (정수, NULL 은 뒤)
3순위: Tag Number ASC
```

즉 **Loop Number 가 없는 Local gauge 류 태그가 시트 상단** 에 모이고, 그 뒤로 Loop 가 있는 태그가 Loop 단위로 그룹화되어 나옵니다. 같은 Loop 안에서는 Internal Loop Order 가 작은 것부터.

**Loop 그룹 사이의 빈 줄.** 정렬 결과에서 Loop Number 가 바뀔 때마다 한 줄을 비워 가독성을 확보합니다. 단 Local gauge 블록(loop=NULL) 과 첫 Loop 블록 사이에는 빈 줄을 넣지 않습니다 (이전 Loop 가 NULL 인 경우는 separator skip).

**Overflow.** 한 페이지의 `data_row_end - data_row_start + 1` 줄을 초과하면 자동으로 다음 페이지를 만들어 이어 stamp 합니다. 만약 단일 페이지에 모든 태그가 안 들어가는 보기 드문 경우(특수 mapping 이슈) 에는 응답 헤더 `X-IIS-Overflowed: 1` + UI 메시지로 알려줍니다.

**산출물 구조 (Auto 모드 예).**

```
IIS_auto.zip
├── SA-2781A/
│   ├── SA-2781A_page001-of-007.xlsx
│   ├── SA-2781A_page002-of-007.xlsx
│   ├── ...
│   └── SA-2781A_MERGED.xlsx        ← 한 시트에 평면 dump (검수용)
├── SA-2781B/
│   └── ...
├── UNCLASSIFIED.csv                 ← 어느 룰에도 매칭 안 된 태그 목록
└── SUMMARY.txt                      ← 템플릿별 stamp 건수, overflow 여부 등
```

**Single template 모드** 도 비슷하지만 폴더 분리 없이 ZIP 안에 페이지 + MERGED 만 들어 있습니다.

**다운로드 후 응답 메타데이터.** UI 하단에 다음 정보가 표시됩니다.

| 헤더 | 의미 |
|---|---|
| `tags=N` | 총 fetch 된 태그 수 |
| `stamped=N` | 실제로 시트에 찍힌 셀의 태그 수 |
| `unclassified=N` | UNCLASSIFIED 로 빠진 태그 수 (Auto 모드만) |
| `templates=A,B,C` | 사용된 템플릿 목록 (Auto 모드만) |
| `OVERFLOWED` | 한 페이지의 data row 범위를 넘긴 페이지가 있음 |
| `header[sheet=X+Y, rev=X+Y, doc=X+Y]` | header placeholder stamp 통계 (configured + placeholder 각각) |

##### 데이터 의존성

- IIS Generation 은 Master Index 의 `is_committed=true` 인 record 만 읽어옵니다. Index 에서 셀 편집 후 **Save 를 누르지 않은 변경분** 은 반영되지 않습니다.
- ISS 필드를 매핑한 컬럼은 **현재 active revision** 의 값을 사용합니다. 새 revision 작성 중이라면 commit 까지 끝낸 뒤 generate 해야 최신 값이 반영됩니다.
- 템플릿 xlsx 자체는 Supabase Storage `templates` 버킷의 `iis/{template_code}.xlsx` 경로에 있어야 합니다 (Admin 이 사전 업로드).

##### Drawings 미래 기능 (Phase 3+)

| 기능 | 설명 | 필요 권한 |
|---|---|---|
| Junction Box / Cable / Terminal 관리 | 배선 정보 입력 | Editor 이상 |
| Loop / Hook-up 도면 자동 생성 | 템플릿 기반 DXF + PDF 출력 | Editor 이상 |
| 도면 조회·다운로드 | 산출물 열람 | Viewer 이상 |
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
