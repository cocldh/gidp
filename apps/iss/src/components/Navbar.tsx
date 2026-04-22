'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
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

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        href={href}
        className={
          'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
          (active
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900')
        }
      >
        {label}
      </Link>
    )
  }

  return (
    <nav className="bg-white border-b border-gray-100 shadow-sm px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-5">
          <a
            href="/"
            className="text-xs text-gray-400 hover:text-blue-600 transition-colors flex items-center gap-1"
            title="GIDP Dashboard"
          >
            ← GIDP
          </a>
          <Link
            href="/dashboard"
            className="text-lg font-bold text-[#000080]"
          >
            ISS
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {navLink('/dashboard', 'Form View')}
            {navLink('/browser', 'Browser View')}
            {canViewChangelog && navLink('/changelog', 'Change Log')}
            {canManageForms && navLink('/forms', 'Form Management')}
            {canManageForms && navLink('/admin/merge', 'Field Management')}
            {isGlobalAdmin && navLink('/admin/users', 'User Management')}
            {isGlobalAdmin && navLink('/admin/fields', 'Default Fields')}
            {isGlobalAdmin && navLink('/admin/projects', 'Projects')}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {projectName && (
            <a
              href="/project"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs text-blue-600 transition-colors"
              title="프로젝트 전환"
            >
              <span>📁</span>
              <span className="max-w-32 truncate">{projectName}</span>
              <span className="text-blue-400 text-xs">▼</span>
            </a>
          )}
          {profile && (
            <span className="hidden sm:inline text-gray-400 text-xs">
              {profile.email}
              <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                {effectiveAccess}
              </span>
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
