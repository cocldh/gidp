import { redirect } from 'next/navigation'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import GenerationForm from './GenerationForm'
import Navbar from '@/components/Navbar'
import IisSubnav from '@/components/IisSubnav'

interface TemplateRow {
  template_code: string
  description: string | null
}

export default async function IisGeneratePage() {
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

  const { data: templates } = await supabase
    .schema('drawings')
    .from('iis_template_layout')
    .select('template_code, description')
    .eq('is_active', true)
    .order('template_code')

  return (
    <div className="min-h-screen">
      <Navbar />
      <IisSubnav />

      <main className="max-w-5xl mx-auto px-6 py-6">
        <p className="text-sm text-gray-500 mb-6">
          SA form 한 개를 선택해서 해당 템플릿에 모든 태그를 stamp 한 ZIP 을 받거나, <b>Auto</b> 로 classification rule 기반으로 모든 템플릿을 한 번에 생성합니다.
        </p>
        <GenerationForm templates={(templates ?? []) as TemplateRow[]} />
      </main>
    </div>
  )
}
