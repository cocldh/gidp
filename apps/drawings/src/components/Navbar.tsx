// Drawings 앱 공통 상단 네비게이션 바
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Home, FolderKanban, LogOut } from 'lucide-react'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole } from '@gidp/ui'

export default function Navbar() {
  const supabase = createClient()
  const pathname = usePathname()
  const [projectId, setProjectId] = useState<number | null>(null)
  const [projectName, setProjectName] = useState<string>('')

  useEffect(() => {
    const id = readProjectIdCookie()
    setProjectId(id)
    if (id == null) { setProjectName(''); return }
    supabase
      .from('project')
      .select('project_name')
      .eq('project_id', id)
      .single()
      .then(({ data }) => { setProjectName(data?.project_name ?? String(id)) })
  }, [])

  const { email, globalRole, projectRole, loading } = useUserRole(projectId, 'drawings')

  const effectiveAccess: string =
    globalRole === 'Admin'
      ? 'Admin'
      : globalRole === 'Active'
        ? (projectRole ?? 'none')
        : 'none'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  const btnBase =
    'flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white border-gray-200 text-gray-700'

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        href={href}
        className={
          'flex items-center gap-2 border px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
          (active
            ? 'bg-blue-50 text-blue-600 border-blue-200'
            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600')
        }
      >
        {label}
      </Link>
    )
  }

  return (
    <nav className="px-6 pt-6 pb-2">
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/dashboard" className="text-2xl font-bold text-[#000080] mr-1">
            GIDP Drawings
          </Link>
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {navLink('/dashboard', 'Dashboard')}
            {navLink('/iis', 'IIS')}
            <span className="flex items-center gap-1 border px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-300 border-gray-100 cursor-not-allowed select-none">
              Wiring
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-400 font-normal">soon</span>
            </span>
            <span className="flex items-center gap-1 border px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-300 border-gray-100 cursor-not-allowed select-none">
              Loop
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-400 font-normal">soon</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!loading && email && (
            <span className="hidden sm:inline text-gray-400 text-xs">
              {email}
              <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                {effectiveAccess}
              </span>
            </span>
          )}

          <a href="/" className={`${btnBase} hover:border-blue-400`} title="GIDP Dashboard">
            <Home size={16} />
          </a>

          {projectName && (
            <a href="/project" className={`${btnBase} hover:border-blue-400`} title="프로젝트 전환">
              <FolderKanban size={16} />
              <span className="max-w-32 truncate">{projectName}</span>
            </a>
          )}

          <button
            onClick={handleLogout}
            className={`${btnBase} hover:border-red-400 hover:text-red-500`}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}
