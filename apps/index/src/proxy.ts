import { createAuthMiddleware } from '@gidp/auth/middleware';

export const proxy = createAuthMiddleware({
  loginPath: '/login',
  postLoginPath: '/',
  requireProjectCookie: 'gidp_project_id',
  projectSelectPath: '/project',
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
