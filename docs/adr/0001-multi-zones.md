# ADR 0001 — Multi-Zones vs Subdomain Federation

**Status**: Accepted (2026-04)

## Context

GIDP는 iss·index·drawings 세 개의 독립 Next.js 앱으로 구성되는데, 사용자에게 "하나의 플랫폼"으로 보여야 한다. 배포·라우팅 전략에 두 선택지가 있었다.

**Option A — Subdomain federation**: 각 앱을 `iss.gidp.com`·`index.gidp.com`·`drawings.gidp.com`으로 개별 배포. 허브는 `gidp.com`. 공통 parent domain 쿠키로 SSO.

**Option B — Next.js Multi-Zones**: 단일 도메인 `gidp.com` 아래 path 기반(`/iss`, `/index`, `/drawings`). shell 앱이 rewrite를 담당하고 각 zone은 독립 배포이지만 rewrite 뒷단에 숨김.

사용자의 멘탈 모델 인용:
> "Tool은 각자 iss-web, index, drawing 등으로 다르지만, 전체적으로 하나의 Platform이라고 생각. 개별로 따로 구현되는 것은 원하는 구조가 아님."

## Decision

**Option B (Multi-Zones)** 채택.

구현:
- `apps/shell`의 `next.config.ts`에 `rewrites()` 정의. 헬퍼 `zoneRewrites(prefix, origin)`가 `prefix`와 `prefix/:path*` 두 매칭 반환 — `_next/static` 자산까지 forward.
- 각 zone 앱에 `basePath: "/iss"` 등 설정. 자산 URL에 자동 prefix 붙음.
- zone URL은 환경변수 (`ISS_ZONE_URL` 등). dev는 localhost 포트, prod는 zone 전용 Vercel private URL.
- zone에서 shell로 돌아가는 링크·redirect는 basePath를 우회해야 함 — raw `<a>`, `window.location.assign`, 서버 `redirect('/path')` 사용.

## Consequences

**Good**
- 사용자에게 한 도메인·단일 SPA 느낌. URL이 `gidp.com/iss/...`로 일관.
- 쿠키·세션이 same-origin이라 parent domain 설정 불필요.
- 각 zone은 여전히 독립 배포 단위 — 팀 경계·CI·롤백을 zone별로 가져갈 수 있음.

**Bad / 주의사항**
- basePath와 rewrite를 이해해야 링크·redirect 작성이 헷갈리지 않음. 개발자 온보딩 비용 있음.
- 미들웨어 redirect는 Next.js 내부 `parseURL`이 절대 URL 요구. raw `NextResponse`에 relative Location 넣으면 500. 반드시 `NextResponse.redirect(new URL(path, request.nextUrl))`.
- 자산 서빙이 shell rewrite에 의존 — rewrite 헬퍼가 `_next` 경로도 커버해야 함.
- zone의 server-side `redirect()`는 origin-relative라 basePath 영향 안 받지만, 클라이언트 `<Link>`는 basePath prepend됨. 같은 "/"이라도 컨텍스트에 따라 의미가 다름.

**Revisit 조건**: zone 수가 크게 늘거나, 팀이 완전히 분리되어 독립 배포 속도가 bottleneck이 되면 Option A 재검토.
