// IIS 서브모듈 랜딩 페이지
import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import Navbar from '@/components/Navbar'
import IisSubnav from '@/components/IisSubnav'

export default async function IisPage() {
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

  return (
    <div className="min-h-screen">
      <Navbar />
      <IisSubnav />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold mb-1 text-[#000080]">IIS — Instrument Installation Schedule</h1>
        <p className="text-sm text-gray-500 mb-8">
          Aramco 표준 IIS 템플릿 기반으로 프로젝트 태그 전체의 시트를 자동 생성합니다.
          아래 단계 순서로 설정 후 Generation을 실행하세요.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="/drawings/iis/mapping"
            className="group block rounded-xl border border-gray-200 bg-white p-5 hover:border-[#000080] hover:shadow-sm transition-all"
          >
            <div className="text-xs font-semibold text-gray-400 mb-1">Step 1</div>
            <div className="text-base font-bold text-[#000080] mb-1">Column Mapping</div>
            <div className="text-sm text-gray-500">IIS 템플릿의 각 열을 idx·iss 필드 또는 상수에 매핑합니다.</div>
            <div className="mt-4 text-xs text-gray-400 group-hover:text-[#000080] transition-colors">설정 →</div>
          </a>

          <a
            href="/drawings/iis/classification"
            className="group block rounded-xl border border-gray-200 bg-white p-5 hover:border-[#000080] hover:shadow-sm transition-all"
          >
            <div className="text-xs font-semibold text-gray-400 mb-1">Step 2</div>
            <div className="text-base font-bold text-[#000080] mb-1">Classification</div>
            <div className="text-sm text-gray-500">Function Key 기준으로 태그를 각 IIS 템플릿에 분류하는 규칙을 설정합니다.</div>
            <div className="mt-4 text-xs text-gray-400 group-hover:text-[#000080] transition-colors">설정 →</div>
          </a>

          <a
            href="/drawings/iis/generate"
            className="group block rounded-xl border border-gray-200 bg-white p-5 hover:border-[#000080] hover:shadow-sm transition-all"
          >
            <div className="text-xs font-semibold text-gray-400 mb-1">Step 3</div>
            <div className="text-base font-bold text-[#000080] mb-1">Generation</div>
            <div className="text-sm text-gray-500">설정이 완료된 템플릿으로 전체 태그 IIS 시트를 생성하고 ZIP으로 다운로드합니다.</div>
            <div className="mt-4 text-xs text-gray-400 group-hover:text-[#000080] transition-colors">실행 →</div>
          </a>
        </div>
      </main>
    </div>
  )
}
