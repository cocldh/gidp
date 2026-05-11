import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import ClassificationEditor from './ClassificationEditor'

interface TemplateRow {
  template_code: string
  description: string | null
}

interface InstrumentTypeRow {
  instrument_type: string
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

  const [{ data: templates }, { data: typeSummary, error: typeErr }] = await Promise.all([
    supabase
      .schema('drawings')
      .from('iis_template_layout')
      .select('template_code, description')
      .eq('is_active', true)
      .order('template_code'),
    supabase
      .schema('drawings')
      .rpc('iis_instrument_type_summary', { p_project_id: projectId }),
  ])

  if (typeErr) {
    return (
      <div className="min-h-screen p-8">
        <h1 className="text-xl font-bold mb-2 text-red-600">Failed to load instrument types</h1>
        <pre className="text-xs bg-red-50 p-3 rounded">{typeErr.message}</pre>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400">GIDP / Drawings / IIS</div>
            <div className="text-lg font-semibold text-[#000080]">Classification Rules</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <a href="/drawings/iis/mapping" className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              Column Mapping
            </a>
            <a href="/drawings/dashboard" className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              ← Drawings
            </a>
            <a href="/" className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              GIDP Home
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <p className="text-sm text-gray-500 mb-6">
          각 태그를 어떤 IIS 템플릿으로 라우팅할지 정의하는 규칙입니다. 우선순위 (priority) 가 낮을수록 먼저 적용되며,
          가장 먼저 매칭되는 규칙이 사용됩니다. 우측 미리보기로 실제 라우팅 결과를 확인하세요.
        </p>
        <ClassificationEditor
          projectId={projectId}
          templates={(templates ?? []) as TemplateRow[]}
          instrumentTypes={(typeSummary ?? []) as InstrumentTypeRow[]}
        />
      </main>
    </div>
  )
}
