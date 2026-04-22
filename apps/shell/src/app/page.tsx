import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import type { ModuleAccess, ModuleName } from '@gidp/auth'
import { accessAtLeast } from '@gidp/auth'
import SignOutButton from './SignOutButton'

interface Project {
  project_id: number
  project_code: string
  project_name: string
  description: string | null
}

interface ToolCard {
  key: ModuleName
  title: string
  description: string
  url: string
  accent: string
  available: boolean
}

export default async function DashboardPage() {
  const projectId = await getServerProjectId()
  if (!projectId) redirect('/project')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role, display_name, username')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'Pending') redirect('/pending')

  const { data: project } = await supabase
    .from('project')
    .select('project_id, project_code, project_name, description')
    .eq('project_id', projectId)
    .maybeSingle<Project>()

  if (!project) redirect('/project')

  // Module access — Admin has full access to everything; otherwise read from user_project_module.
  let moduleAccess: Record<ModuleName, ModuleAccess> = {
    iss: 'None',
    idx: 'None',
    drawings: 'None',
  }

  if (profile.role === 'Admin') {
    moduleAccess = { iss: 'Admin', idx: 'Admin', drawings: 'Admin' }
  } else {
    const { data: rows } = await supabase
      .from('user_project_module')
      .select('module, access')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
    for (const row of rows ?? []) {
      moduleAccess[row.module as ModuleName] = row.access as ModuleAccess
    }
  }

  const tools: ToolCard[] = [
    {
      key: 'idx',
      title: 'Master Index',
      description: '프로젝트 전체 계장 Tag 마스터 관리 (200+ 컬럼, Excel 업로드)',
      url: '/index',
      accent: 'from-emerald-500 to-teal-600',
      available: accessAtLeast(moduleAccess.idx, 'Viewer'),
    },
    {
      key: 'iss',
      title: 'Spec Sheet (ISS)',
      description: 'Instrument Specification Sheet 작성 · 템플릿 · 리비전 관리',
      url: '/iss',
      accent: 'from-blue-500 to-indigo-600',
      available: accessAtLeast(moduleAccess.iss, 'Viewer'),
    },
    {
      key: 'drawings',
      title: 'Drawings',
      description: 'JB Wiring · Loop · Hook-up 도면 자동 생성 (DXF + PDF)',
      url: '/drawings',
      accent: 'from-amber-500 to-orange-600',
      available: accessAtLeast(moduleAccess.drawings, 'Viewer'),
    },
  ]

  const displayName = profile.display_name || profile.username || user.email

  return (
    <div className="min-h-screen bg-[#f7f4ef]">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400">GIDP</div>
            <div className="text-lg font-semibold">
              <span className="text-[#000080] font-bold">
                {project.project_name}
              </span>
              <span className="ml-2 text-sm font-mono text-gray-400">{project.project_code}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              {displayName}
              {profile.role === 'Admin' && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                  Admin
                </span>
              )}
            </span>
            <Link
              href="/project"
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition-colors"
            >
              프로젝트 변경
            </Link>
            {profile.role === 'Admin' && (
              <a
                href="/iss/admin"
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition-colors"
              >
                Admin
              </a>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1 text-[#000080]">도구 선택</h1>
          <p className="text-gray-500 text-sm">
            이 프로젝트에서 사용할 GIDP 도구를 선택하세요.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tools.map((tool) => {
            const body = (
              <div
                className={`relative h-full rounded-xl overflow-hidden border border-gray-200 bg-white ${
                  tool.available
                    ? 'hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <div className={`h-2 bg-gradient-to-r ${tool.accent}`} />
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-semibold text-gray-900">{tool.title}</h2>
                    {!tool.available && (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">
                        No Access
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{tool.description}</p>
                  {tool.available && (
                    <div className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-gray-900">
                      Open
                      <span className="text-base">→</span>
                    </div>
                  )}
                </div>
              </div>
            )

            if (!tool.available) {
              return <div key={tool.key}>{body}</div>
            }
            return (
              <a key={tool.key} href={tool.url} rel="noopener">
                {body}
              </a>
            )
          })}
        </div>
      </main>
    </div>
  )
}
