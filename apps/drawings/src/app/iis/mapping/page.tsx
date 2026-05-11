import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import MappingEditor from './MappingEditor'

interface TemplateLayout {
  template_code: string
  description: string | null
  banner_text: string
  data_row_start: number
  data_row_end: number
  item_col_letter: string | null
  tag_col_letter: string
}

// Server component: gate + load static template list. The editor itself is
// client-side and pulls mappings/sources via the user's authenticated supabase
// session (RLS enforces drawings module access).
export default async function IisMappingPage() {
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

  const { data: templates, error } = await supabase
    .schema('drawings')
    .from('iis_template_layout')
    .select('template_code, description, banner_text, data_row_start, data_row_end, item_col_letter, tag_col_letter')
    .eq('is_active', true)
    .order('template_code')

  if (error) {
    return (
      <div className="min-h-screen p-8">
        <h1 className="text-xl font-bold mb-2 text-red-600">Failed to load templates</h1>
        <pre className="text-xs bg-red-50 p-3 rounded">{error.message}</pre>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400">GIDP / Drawings / IIS</div>
            <div className="text-lg font-semibold text-[#000080]">Column Mapping</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <a href="/drawings/iis/classification" className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              Classification Rules
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

      <main className="max-w-6xl mx-auto px-6 py-6">
        <p className="text-sm text-gray-500 mb-6">
          Aramco 표준 IIS 템플릿의 각 출력 컬럼 (xlsx 열)을 idx 컬럼·iss 필드·상수 중 하나에 매핑합니다.
          매핑은 현재 프로젝트 (project_id={projectId}) 에만 적용됩니다.
        </p>
        <MappingEditor
          projectId={projectId}
          templates={(templates ?? []) as TemplateLayout[]}
        />
      </main>
    </div>
  )
}
