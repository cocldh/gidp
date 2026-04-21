import { NextRequest, NextResponse } from 'next/server'
import { PROJECT_CODE_REGEX } from '@gidp/domain/public'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  // 1. 요청자 인증 + Global Admin 확인
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'Admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // 2. 요청 파라미터
  const { project_code, project_name, description } = await req.json()

  if (!project_code || !project_name) {
    return NextResponse.json({ error: 'project_code와 project_name은 필수입니다' }, { status: 400 })
  }

  if (!PROJECT_CODE_REGEX.test(project_code)) {
    return NextResponse.json(
      { error: 'project_code 형식이 올바르지 않습니다. e|p + 숫자 6자리 (예: e230350)' },
      { status: 400 },
    )
  }

  // 3. SECURITY DEFINER RPC: insert public.project + seed iss.field_def from default_field_def
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('iss_create_project_and_seed', {
    p_code:        project_code,
    p_name:        project_name,
    p_description: description || null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ project_id: data })
}
