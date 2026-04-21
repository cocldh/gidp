import { createAuthMiddleware } from '@gidp/auth/middleware';

export const proxy = createAuthMiddleware({
  loginPath: '/login',
  postLoginPath: '/dashboard',
  requireProjectCookie: 'gidp_project_id',
  projectSelectPath: '/project',
});

export const config = {
  // basePath 가 /iss 라 요청 경로는 /iss/_next/... 로 들어옴. 두 형태 모두 bypass.
  // 루트('/')는 `/((?!...).*)` 패턴에서 빠지므로 명시적으로 추가.
  matcher: [
    '/',
    '/((?!_next/static|_next/image|iss/_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
