import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  console.log('[check-role] user.id:', user.id, '| profile:', profile, '| error:', profileError)
  return NextResponse.json({ role: profile?.role ?? null })
}
