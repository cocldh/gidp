import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: myProfile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()
  if (myProfile?.role !== 'Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, username } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const trimmed = (username ?? '').trim()
  if (trimmed && !/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return NextResponse.json({ error: '영문자, 숫자, _만 사용 가능합니다.' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  if (trimmed) {
    const { data: existing } = await adminClient
      .from('user_profile')
      .select('id')
      .eq('username', trimmed)
      .neq('id', userId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 username입니다.' }, { status: 409 })
    }
  }

  const { error } = await adminClient
    .from('user_profile')
    .update({ username: trimmed || null })
    .eq('id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
