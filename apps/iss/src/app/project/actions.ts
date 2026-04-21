'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function selectProject(projectCode: string) {
  const cookieStore = await cookies()
  cookieStore.set('iss_project', projectCode, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30일
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // 클라이언트 JS에서도 document.cookie로 읽을 수 있어야 함
  })
  redirect('/dashboard')
}
