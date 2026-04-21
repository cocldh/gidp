import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  // Verify the caller is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const username = body?.username
  if (!username || typeof username !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Use admin client (bypasses RLS) and upsert so it works whether
  // the profile row already exists (trigger created it) or not yet.
  const admin = createAdminClient()
  const { error } = await admin
    .from('user_profile')
    .upsert(
      { id: user.id, email: user.email ?? '', role: 'Pending', username: username.trim() },
      { onConflict: 'id' }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
