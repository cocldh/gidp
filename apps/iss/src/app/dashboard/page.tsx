import { redirect } from 'next/navigation'
import { createClient, getServerProjectSchema } from '@/lib/supabase-server'
import Navbar from '@/components/Navbar'
import TagList from '@/components/TagList'

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

  // Admin은 project role 체크 없이 진입 허용
  if (profile.role !== 'Admin') {
    const projectSchema = await getServerProjectSchema()

    // 프로젝트가 선택되지 않은 경우
    if (!projectSchema) redirect('/project')

    const { data: project } = await supabase
      .from('project')
      .select('project_id')
      .eq('project_code', projectSchema)
      .single()

    if (!project) redirect('/project')

    // 해당 프로젝트에 role이 지정되어 있는지 확인
    const { data: upr } = await supabase
      .from('user_project_role')
      .select('role')
      .eq('user_id', user.id)
      .eq('project_id', project.project_id)
      .maybeSingle()

    if (!upr) redirect('/project')
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Tags</h1>
        <TagList />
      </main>
    </div>
  )
}
