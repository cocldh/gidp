import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'

// IIS UI lands here in Step 2. For now: gate checks + placeholder.
// Path-only redirects resolve against the request origin which, via shell's
// multi-zone rewrite, is the shell host. basePath is not prepended by
// Next.js server redirect() for origin-relative paths.
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
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400">GIDP / Drawings</div>
            <div className="text-lg font-semibold text-[#000080]">Drawings</div>
          </div>
          <a
            href="/"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition-colors"
          >
            ← GIDP
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-2 text-[#000080]">Drawings</h1>
        <p className="text-gray-500 text-sm mb-8">
          IIS (Instrument Installation Schedule) 도구가 곧 추가됩니다. JB Wiring · Loop · Hook-up은 그 다음.
        </p>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-sm text-gray-500">project_id: <span className="font-mono text-gray-800">{projectId}</span></div>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/drawings/iis/mapping"
              className="inline-flex items-center gap-2 px-4 py-2 border border-[#000080] text-[#000080] rounded text-sm hover:bg-[#000080]/5"
            >
              IIS Column Mapping →
            </a>
            <a
              href="/drawings/iis/classification"
              className="inline-flex items-center gap-2 px-4 py-2 border border-[#000080] text-[#000080] rounded text-sm hover:bg-[#000080]/5"
            >
              IIS Classification Rules →
            </a>
            <a
              href="/drawings/iis/generate"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#000080] text-white rounded text-sm hover:bg-[#000060]"
            >
              IIS Generation →
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
