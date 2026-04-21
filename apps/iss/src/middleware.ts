import { createAuthMiddleware, DEFAULT_MATCHER } from '@gidp/auth/middleware';

export const middleware = createAuthMiddleware({
  loginPath: '/login',
  postLoginPath: '/project',
});

export const config = {
  matcher: DEFAULT_MATCHER,
};
