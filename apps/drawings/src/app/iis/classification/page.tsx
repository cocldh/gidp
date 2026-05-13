import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import ClassificationEditor from './ClassificationEditor'
import Navbar from '@/components/Navbar'
import IisSubnav from '@/components/IisSubnav'

interface TemplateRow {
  template_code: string
  description: string | null
}

interface LoopTypeRow {
  loop_type: string
  n: number
}

export default async function IisClassificationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const projectId = await getServerProjectId()
  if (projectId == null) redirect('/project')

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role === 'Pending') redirect('/pending')

  const [{ data: templates }, { data: loopTypeSummary, error: ltErr }] = await Promise.all([
    supabase
      .schema('drawings')
      .from('iis_template_layout')
      .select('template_code, description')
      .eq('is_active', true)
      .order('template_code'),
    supabase
      .schema('drawings')
      .rpc('iis_loop_type_summary', { p_project_id: projectId }),
  ])

  if (ltErr) {
    return (
      <div className="min-h-screen p-8">
        <h1 className="text-xl font-bold mb-2 text-red-600">Failed to load loop types</h1>
        <pre className="text-xs bg-red-50 p-3 rounded">{ltErr.message}</pre>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <IisSubnav />

      <main className="max-w-7xl mx-auto px-6 py-6">
        <p className="text-sm text-gray-500 mb-6">
          Index 의 <code className="font-mono">7_LOOP TYPE</code> 컬럼값을 기준으로 각 태그를 어떤 IIS 템플릿으로 라우팅할지 정의합니다.
          우선순위(priority) 가 낮을수록 먼저 적용되며, 가장 먼저 매칭되는 규칙이 사용됩니다. 우측 미리보기로 실제 라우팅 결과를 확인하세요.
        </p>
        <ClassificationEditor
          projectId={projectId}
          templates={(templates ?? []) as TemplateRow[]}
          loopTypes={(loopTypeSummary ?? []) as LoopTypeRow[]}
        />
      </main>
    </div>
  )
}
