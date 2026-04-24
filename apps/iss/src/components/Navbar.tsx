'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Home, FolderKanban, LogOut,
  ClipboardList, Search, History,
  Settings, ArrowLeftRight, LayoutTemplate, Folders,
} from 'lucide-react'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole } from '@/components/RoleGuard'
import type { UserProfile } from '@/lib/types'

export default function Navbar() {
  const supabase = createClient()
  const pathname = usePathname()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const { globalRole, effectiveAccess, hasRole } = useUserRole()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('user_profile')
        .select('*')
        .eq('id', user.id)
        .single()
      if (data) setProfile(data)
    }
    loadProfile()
  }, [])

  useEffect(() => {
    const projectId = readProjectIdCookie()
    if (projectId == null) {
      setProjectName('')
      return
    }
    supabase
      .from('project')
      .select('project_name')
      .eq('project_id', projectId)
      .single()
      .then(({ data }) => {
        setProjectName(data?.project_name ?? String(projectId))
      })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  const isGlobalAdmin = globalRole === 'Admin'
  const canManageForms = hasRole('ProjectAdmin')
  const canViewChangelog = hasRole('Editor')

  const btnBase =
    'flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white border-gray-200 text-gray-700'

  const navLink = (href: string, Icon: React.ElementType, label: string) => {
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
        <Icon size={15} />
        {label}
      </Link>
    )
  }

  return (
    <nav className="px-6 pt-6 pb-2">
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        {/* Left: title + nav links */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/dashboard" className="text-2xl font-bold text-[#000080] mr-1">
            GIDP ISS
          </Link>
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {navLink('/dashboard', ClipboardList, 'Form View')}
            {navLink('/browser', Search, 'Browser View')}
            {canViewChangelog && navLink('/changelog', History, 'Change Log')}
            {canManageForms && navLink('/forms', Settings, 'Form Management')}
            {canManageForms && navLink('/admin/merge', ArrowLeftRight, 'Field Management')}
            {isGlobalAdmin && navLink('/admin/fields', LayoutTemplate, 'Default Fields')}
            {isGlobalAdmin && navLink('/admin/projects', Folders, 'Projects')}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-3">
          {profile && (
            <span className="hidden sm:inline text-gray-400 text-xs">
              {profile.email}
              <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                {effectiveAccess}
              </span>
            </span>
          )}

          <a
            href="/"
            className={`${btnBase} hover:border-blue-400`}
            title="GIDP Dashboard"
          >
            <Home size={16} />
          </a>

          {projectName && (
            <a
              href="/project"
              className={`${btnBase} hover:border-blue-400`}
              title="프로젝트 전환"
            >
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
