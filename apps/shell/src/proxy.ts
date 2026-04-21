import { createAuthMiddleware } from '@gidp/auth/middleware';

export const proxy = createAuthMiddleware({
  loginPath: '/login',
  postLoginPath: '/project',
});

export const config = {
  // Multi-zone: zone 의 asset (/iss/_next/*, /index/_next/*, /drawings/_next/*) 도
  // 미들웨어를 건너뛰고 바로 rewrite 로 넘겨서 불필요한 세션 검사 오버헤드 제거.
  matcher: [
    '/((?!_next/static|_next/image|(?:iss|index|drawings)/_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
