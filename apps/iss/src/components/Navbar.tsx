'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient, getProjectSchema } from '@/lib/supabase-client'
import { useUserRole } from '@/components/RoleGuard'
import type { UserProfile } from '@/lib/types'

export default function Navbar() {
  const supabase = createClient()
  const router = useRouter()
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
    const schema = getProjectSchema()
    supabase
      .from('project')
      .select('project_name')
      .eq('project_code', schema || 'public')
      .single()
      .then(({ data }) => {
        if (data) setProjectName(data.project_name)
        else setProjectName(schema || 'public')
      })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isGlobalAdmin = globalRole === 'Admin'
  // ProjectAdmin or Global Admin can access form/field management
  const canManageForms = hasRole('ProjectAdmin')
  // Only Global Admin can access User Management
  // Editor+ can access Change Log
  const canViewChangelog = hasRole('Editor')

  return (
    <nav className="bg-gray-900 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold">
            ISS Web
          </Link>
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="hover:text-gray-300">
              Form View
            </Link>
            <Link href="/browser" className="hover:text-gray-300">
              Browser View
            </Link>
            {canViewChangelog && (
              <Link href="/changelog" className="hover:text-gray-300">
                Change Log
              </Link>
            )}
            {canManageForms && (
              <>
                <Link href="/forms" className="hover:text-gray-300">
                  Form Management
                </Link>
                <Link href="/admin/merge" className="hover:text-gray-300">
                  Field Management
                </Link>
              </>
            )}
            {isGlobalAdmin && (
              <Link href="/admin/users" className="hover:text-gray-300">
                User Management
              </Link>
            )}
            {isGlobalAdmin && (
              <Link href="/admin/fields" className="hover:text-gray-300">
                Default Fields
              </Link>
            )}
            {isGlobalAdmin && (
              <Link href="/admin/projects" className="hover:text-gray-300">
                Projects
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {projectName && (
            <Link
              href="/project"
              className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-blue-800 hover:bg-blue-700 rounded text-xs text-blue-200"
              title="프로젝트 전환"
            >
              <span>📁</span>
              <span className="max-w-32 truncate">{projectName}</span>
              <span className="text-blue-400 text-xs">▼</span>
            </Link>
          )}
          {profile && (
            <span className="hidden sm:inline text-gray-400">
              {profile.email}
              <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-gray-700">
                {effectiveAccess}
              </span>
            </span>
          )}
          <button
            onClick={handleLogout}
            className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
