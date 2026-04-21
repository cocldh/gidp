import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import ProjectSelector from './ProjectSelector'

interface ProjectPageProps {
  searchParams: Promise<{ return_to?: string }>
}

export default async function ProjectPage({ searchParams }: ProjectPageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'Pending') redirect('/pending')

  let projectList: { project_id: number; project_code: string; project_name: string; description: string | null }[] = []

  if (profile.role === 'Admin') {
    const { data } = await supabase
      .from('project')
      .select('project_id, project_code, project_name, description')
      .order('project_id')
    projectList = data ?? []
  } else {
    const { data: roleRows } = await supabase
      .from('user_project_role')
      .select('project_id')
      .eq('user_id', user.id)
    const assignedIds = (roleRows ?? []).map((r: { project_id: number }) => r.project_id)

    if (assignedIds.length > 0) {
      const { data } = await supabase
        .from('project')
        .select('project_id, project_code, project_name, description')
        .in('project_id', assignedIds)
        .order('project_id')
      projectList = data ?? []
    }
  }

  const { return_to } = await searchParams

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">프로젝트 선택</h1>
        <p className="text-gray-500 text-center mb-8">
          작업할 프로젝트를 선택하세요.
          {profile.display_name && (
            <span className="ml-1">안녕하세요, <strong>{profile.display_name}</strong>님.</span>
          )}
        </p>

        {projectList.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center">
            <p className="text-gray-500 mb-4">접근 가능한 프로젝트가 없습니다.</p>
            <p className="text-sm text-gray-400">
              관리자에게 프로젝트 역할 지정을 요청하세요.
            </p>
          </div>
        ) : (
          <ProjectSelector projects={projectList} returnTo={return_to} />
        )}
      </div>
    </div>
  )
}
