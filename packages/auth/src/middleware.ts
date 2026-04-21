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
    const returnToPath = request.nextUrl.pathname + request.nextUrl.search;

    // Next.js middleware requires an absolute URL in Location. We construct it
    // from request.nextUrl so the redirect resolves against the *public* origin
    // the browser actually sent (e.g. http://localhost:3000), not a zone's
    // internal origin. In multi-zone production, if a zone's middleware ever
    // needs to redirect cross-origin, pass the public origin via a header/env.
    const redirectTo = (path: string) =>
      NextResponse.redirect(new URL(path, request.nextUrl));

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
