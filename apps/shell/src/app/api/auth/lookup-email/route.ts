import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const username = body?.username
  if (!username || typeof username !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data } = await admin
    .from('user_profile')
    .select('email')
    .eq('username', username.trim())
    .maybeSingle()

  if (!data?.email) {
    return NextResponse.json({ error: 'Username not found' }, { status: 404 })
  }

  return NextResponse.json({ email: data.email })
}
