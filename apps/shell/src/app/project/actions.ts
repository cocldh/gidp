'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PROJECT_ID_COOKIE } from '@/lib/supabase-server'

const ALLOWED_RETURN_HOSTS = (process.env.NEXT_PUBLIC_ALLOWED_RETURN_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function isSafeReturnUrl(raw: string | undefined): string | null {
  if (!raw) return null
  // Same-origin absolute path. Reject scheme-relative ("//evil.com") and
  // backslash tricks ("/\evil.com") which some browsers parse as absolute.
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) {
    return raw
  }
  try {
    const u = new URL(raw)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return raw
    if (ALLOWED_RETURN_HOSTS.includes(u.host)) return raw
  } catch {
    // fallthrough
  }
  return null
}

export async function selectProject(projectId: number, returnTo?: string) {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error(`Invalid projectId: ${projectId}`)
  }
  const cookieStore = await cookies()
  cookieStore.set(PROJECT_ID_COOKIE, String(projectId), {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
    domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined,
  })

  const safe = isSafeReturnUrl(returnTo)
  redirect(safe ?? '/')
}
