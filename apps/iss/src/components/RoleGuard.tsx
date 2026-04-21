'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createClient, getProjectSchema } from '@/lib/supabase-client'
import type { GlobalRole, ProjectRole } from '@/lib/types'

interface RoleGuardProps {
  /** Minimum role required. Supports legacy values: 'Engineer' maps to 'Editor'. */
  minRole: string
  children: ReactNode
  /** Shown when role is insufficient */
  fallback?: ReactNode
}

// Effective access levels (combines global + project role)
// 'Admin' > 'ProjectAdmin' > 'Editor' > 'Viewer' > 'none'
const EFFECTIVE_LEVEL: Record<string, number> = {
  Admin:        4,
  ProjectAdmin: 3,
  Editor:       2,
  // legacy aliases
  Engineer:     2,
  Viewer:       1,
  none:         0,
}

export function useUserRole() {
  const [globalRole, setGlobalRole] = useState<GlobalRole | null>(null)
  const [projectRole, setProjectRole] = useState<ProjectRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchRoles() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // 1. Fetch global role from user_profile
      const { data: profile } = await supabase
        .from('user_profile')
        .select('role')
        .eq('id', user.id)
        .single()

      const gRole = (profile?.role ?? 'Pending') as GlobalRole
      setGlobalRole(gRole)

      // 2. Global Admin skips project role check
      if (gRole === 'Active') {
        const schema = getProjectSchema()
        if (schema) {
          // Fetch current project's project_id then project role
          const { data: project } = await supabase
            .from('project')
            .select('project_id')
            .eq('project_code', schema)
            .single()

          if (project) {
            const { data: upr } = await supabase
              .from('user_project_role')
              .select('role')
              .eq('user_id', user.id)
              .eq('project_id', project.project_id)
              .single()

            setProjectRole((upr?.role ?? null) as ProjectRole | null)
          }
        } else {
          // No project selected — treat as no project access
          setProjectRole(null)
        }
      }

      setLoading(false)
    }

    fetchRoles()
  }, [])

  /**
   * Effective access level:
   * - Global Admin  → 'Admin'
   * - Active + projectRole  → projectRole ('ProjectAdmin' | 'Editor' | 'Viewer')
   * - Active + no projectRole → 'none' (redirect to /project)
   * - Pending / null → 'none'
   */
  const effectiveAccess: string =
    globalRole === 'Admin' ? 'Admin'
    : globalRole === 'Active' ? (projectRole ?? 'none')
    : 'none'

  /**
   * hasRole: backward-compatible check. Accepts old role names ('Engineer' → 'Editor').
   */
  function hasRole(minRole: string): boolean {
    const minLevel = EFFECTIVE_LEVEL[minRole] ?? 99
    const curLevel = EFFECTIVE_LEVEL[effectiveAccess] ?? 0
    return curLevel >= minLevel
  }

  return { globalRole, projectRole, effectiveAccess, loading, hasRole }
}

export default function RoleGuard({ minRole, children, fallback }: RoleGuardProps) {
  const { effectiveAccess, loading, hasRole } = useUserRole()

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>
  }

  if (!hasRole(minRole)) {
    return (
      fallback ?? (
        <div className="p-8 text-center">
          <h2 className="text-xl font-semibold text-red-600">Access Denied</h2>
          <p className="text-gray-500 mt-2">
            You need <span className="font-medium">{minRole}</span> or higher access to view this page.
            Your current access: <span className="font-medium">{effectiveAccess}</span>
          </p>
        </div>
      )
    )
  }

  return <>{children}</>
}
