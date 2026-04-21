import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — check .env.local',
    );
  }
  return createBrowserClient(url, anonKey);
}

export function readProjectIdCookie(): number | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)gidp_project_id=([^;]+)/);
  const raw = match?.[1];
  if (!raw) return null;
  const parsed = Number.parseInt(decodeURIComponent(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
