// Drawings 허브 — 서브모듈 선택 페이지
import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import Navbar from '@/components/Navbar'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'Pending') redirect('/pending')

  const projectId = await getServerProjectId()
  if (projectId == null) redirect('/project')

  if (profile.role !== 'Admin') {
    const { data: upr } = await supabase
      .from('user_project_role')
      .select('role')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!upr) redirect('/project')
  }

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-1 text-[#000080]">Drawings</h1>
        <p className="text-gray-400 text-sm mb-8">서브모듈을 선택하세요.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* IIS */}
          <a
            href="/drawings/iis"
            className="group block rounded-xl border border-gray-200 bg-white p-6 hover:border-[#000080] hover:shadow-sm transition-all"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Sub-module</div>
            <div className="text-lg font-bold text-[#000080] mb-1">IIS</div>
            <div className="text-sm text-gray-500">Instrument Installation Schedule — 태그별 IIS 시트 자동 생성</div>
            <div className="mt-4 text-xs text-gray-400 group-hover:text-[#000080] transition-colors">열기 →</div>
          </a>

          {/* Wiring — coming soon */}
          <div className="block rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 cursor-not-allowed">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-300 mb-2">Sub-module</div>
            <div className="text-lg font-bold text-gray-300 mb-1">Wiring</div>
            <div className="text-sm text-gray-300">JB Wiring Diagram 자동 생성</div>
            <div className="mt-4 text-xs text-gray-300">준비 중</div>
          </div>

          {/* Loop — coming soon */}
          <div className="block rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 cursor-not-allowed">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-300 mb-2">Sub-module</div>
            <div className="text-lg font-bold text-gray-300 mb-1">Loop</div>
            <div className="text-sm text-gray-300">Loop Diagram 자동 생성</div>
            <div className="mt-4 text-xs text-gray-300">준비 중</div>
          </div>
        </div>
      </main>
    </div>
  )
}
