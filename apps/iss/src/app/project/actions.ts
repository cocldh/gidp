'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PROJECT_ID_COOKIE } from '@/lib/supabase-server'

export async function selectProject(projectId: number) {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error(`Invalid projectId: ${projectId}`)
  }
  const cookieStore = await cookies()
  cookieStore.set(PROJECT_ID_COOKIE, String(projectId), {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // 클라이언트 JS에서도 읽어야 함
  })
  redirect('/dashboard')
}
