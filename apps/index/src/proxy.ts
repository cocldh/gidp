import { createAuthMiddleware } from '@gidp/auth/middleware';

export const proxy = createAuthMiddleware({
  loginPath: '/login',
  postLoginPath: '/',
  requireProjectCookie: 'gidp_project_id',
  projectSelectPath: '/project',
});

export const config = {
  // basePath 가 /index 라 요청 경로는 /index/_next/... 로 들어옴. 두 형태 모두 bypass.
  matcher: [
    '/((?!_next/static|_next/image|index/_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
