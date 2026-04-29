import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = body?.email
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data } = await admin
    .from('user_profile')
    .select('username')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (!data?.username) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  return NextResponse.json({ username: data.username })
}
