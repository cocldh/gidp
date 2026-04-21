import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
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

  let projectId: number | null = null

  if (profile.role !== 'Admin') {
    projectId = await getServerProjectId()
    if (projectId == null) redirect('/project')

    const { data: upr } = await supabase
      .from('user_project_role')
      .select('role')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!upr) redirect('/project')
  } else {
    projectId = await getServerProjectId()
    if (projectId == null) redirect('/project')
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
