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
    // Next.js middleware 는 basePath 를 request.nextUrl.pathname 에서 자동
    // strip 함. return_to 는 브라우저가 보고 있던 전체 경로 (basePath 포함)
    // 여야 하므로 basePath 를 다시 prepend.
    const basePath = request.nextUrl.basePath ?? '';
    const returnToPath = basePath + request.nextUrl.pathname + request.nextUrl.search;

    // Multi-zone 에서 zone 이 reverse-proxy 뒤에 있을 때 request.nextUrl.origin
    // 은 zone 내부 origin (https://gidp-iss.vercel.app) 이라서 그걸로 Location
    // 을 만들면 브라우저가 shell 을 거치지 않고 zone 으로 직접 navigation 함.
    // zone 에 /login 이 없으므로 404. Vercel 의 reverse-proxy 는 원본 Host 를
    // x-forwarded-host 로 넣어주므로 그걸 우선 사용해서 shell origin 기준으로
    // redirect 생성.
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
    const redirectBase = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : request.nextUrl.origin;
    const redirectTo = (target: string) =>
      NextResponse.redirect(new URL(target, redirectBase));

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
