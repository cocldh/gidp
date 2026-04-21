import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export interface AuthMiddlewareConfig {
  /** Route to redirect unauthenticated users to. Default: '/login'. */
  loginPath?: string;
  /** Route to send authenticated users when they hit the login page. Default: '/'. */
  postLoginPath?: string;
  /**
   * Path prefixes that bypass auth. Always includes '/login', '/auth',
   * '/api/auth/', '/api/debug'. Extend via this field per app.
   */
  extraPublicPaths?: string[];
  /**
   * Cookie name that must be present for an authenticated user to proceed.
   * If set and the cookie is missing, the user is bounced to the project
   * selection route. Typically `gidp_project_id`.
   */
  requireProjectCookie?: string;
  /** Path for project selection. Default: '/project'. */
  projectSelectPath?: string;
}

const DEFAULT_PUBLIC_PATHS = ['/login', '/auth', '/api/auth/', '/api/debug'];

export function createAuthMiddleware(config: AuthMiddlewareConfig = {}) {
  const loginPath = config.loginPath ?? '/login';
  const postLoginPath = config.postLoginPath ?? '/';
  const projectSelectPath = config.projectSelectPath ?? '/project';
  const publicPaths = [...DEFAULT_PUBLIC_PATHS, ...(config.extraPublicPaths ?? [])];
  const requireProjectCookie = config.requireProjectCookie;

  return async function middleware(request: NextRequest) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.next();
    }

    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            supabaseResponse = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              supabaseResponse.cookies.set(name, value, options);
            }
          },
        },
      },
    );

    // getSession() — JWT check only, no API round trip. Keeps Edge middleware under Vercel's 1.5s limit.
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const path = request.nextUrl.pathname;
    const isPublic = publicPaths.some((prefix) => path.startsWith(prefix));
    // Next.js 는 middleware 에서 request.nextUrl.pathname 의 basePath 를
    // 자동 strip 함. return_to 는 브라우저가 보고 있던 전체 경로여야 하므로
    // basePath 를 다시 prepend 해서 zone 경로를 보존.
    const basePath = request.nextUrl.basePath ?? '';
    const returnToPath = basePath + request.nextUrl.pathname + request.nextUrl.search;

    // Location 을 상대 경로로 내보내면 브라우저가 **현재 보고 있는 origin**
    // (shell 의 public 도메인) 기준으로 resolve 함. zone 이 reverse-proxy
    // 뒤에 있을 때 `new URL(path, request.nextUrl)` 로 절대 URL 을 쓰면
    // zone 내부 origin (e.g. https://gidp-iss.vercel.app) 이 Location 에
    // 박혀서 shell 을 거치지 않고 cross-origin navigation → 해당 경로가
    // 없는 zone 에서 404 가 남. 상대 경로는 이 문제를 원천 차단.
    const redirectTo = (target: string) => {
      const res = new NextResponse(null, { status: 307 });
      res.headers.set('Location', target);
      return res;
    };

    if (!session && !isPublic) {
      return redirectTo(`${loginPath}?return_to=${encodeURIComponent(returnToPath)}`);
    }

    if (session && path.startsWith(loginPath)) {
      return redirectTo(postLoginPath);
    }

    if (
      session &&
      !isPublic &&
      requireProjectCookie &&
      !request.cookies.get(requireProjectCookie) &&
      !path.startsWith(projectSelectPath)
    ) {
      return redirectTo(`${projectSelectPath}?return_to=${encodeURIComponent(returnToPath)}`);
    }

    return supabaseResponse;
  };
}

export const DEFAULT_MATCHER = [
  '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
];
