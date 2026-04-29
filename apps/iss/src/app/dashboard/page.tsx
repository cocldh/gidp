import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import Navbar from '@/components/Navbar'
import TagList from '@/components/TagList'

// /login, /pending, /project live on shell (same public origin). Path-only
// redirects resolve against the current request's origin which, via the
// shell's multi-zone rewrite, is the shell host. basePath is not prepended
// by Next's server redirect() for origin-relative paths.
export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Middleware ensures user is authenticated before reaching here.
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'Pending') redirect('/pending')

  // Middleware also guarantees gidp_project_id cookie is present.
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
      <main className="max-w-7xl mx-auto px-4 py-6">
        <TagList />
      </main>
    </div>
  )
}
