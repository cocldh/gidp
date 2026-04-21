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
}

const DEFAULT_PUBLIC_PATHS = ['/login', '/auth', '/api/auth/', '/api/debug'];

export function createAuthMiddleware(config: AuthMiddlewareConfig = {}) {
  const loginPath = config.loginPath ?? '/login';
  const postLoginPath = config.postLoginPath ?? '/';
  const publicPaths = [...DEFAULT_PUBLIC_PATHS, ...(config.extraPublicPaths ?? [])];

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

    if (!session && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = loginPath;
      return NextResponse.redirect(url);
    }

    if (session && path.startsWith(loginPath)) {
      const url = request.nextUrl.clone();
      url.pathname = postLoginPath;
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  };
}

export const DEFAULT_MATCHER = [
  '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
];
