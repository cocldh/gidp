import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function DELETE(req: NextRequest) {
  // Verify requester is Admin
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

  const { userId } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === user.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

  const adminClient = createAdminClient()

  try {
    // 1. Delete project roles first (FK dependency on user_profile)
    const { error: e1 } = await adminClient.from('user_project_role').delete().eq('user_id', userId)
    if (e1) console.error('[delete-user] user_project_role delete error:', e1.message)

    // 2. Delete user profile
    const { error: e2 } = await adminClient.from('user_profile').delete().eq('id', userId)
    if (e2) console.error('[delete-user] user_profile delete error:', e2.message)

    // 3. Delete from auth.users — frees the email for re-registration
    const { error: e3 } = await adminClient.auth.admin.deleteUser(userId)
    if (e3) {
      console.error('[delete-user] auth.admin.deleteUser error:', e3.message)
      return NextResponse.json({ error: e3.message }, { status: 500 })
    }
  } catch (err: any) {
    console.error('[delete-user] unexpected error:', err)
    return NextResponse.json({ error: err?.message ?? 'Unexpected error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
