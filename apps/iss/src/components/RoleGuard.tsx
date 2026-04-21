'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole as useBaseUserRole } from '@gidp/ui/use-user-role'
import type { GlobalRole, ProjectRole } from '@gidp/auth'

const EFFECTIVE_LEVEL: Record<string, number> = {
  Admin:        4,
  ProjectAdmin: 3,
  Editor:       2,
  Engineer:     2, // legacy alias
  Viewer:       1,
  none:         0,
}

export function useUserRole() {
  const [projectId, setProjectId] = useState<number | null>(null)
  useEffect(() => {
    setProjectId(readProjectIdCookie())
  }, [])

  const base = useBaseUserRole(projectId, 'iss')

  const effectiveAccess: string =
    base.globalRole === 'Admin'
      ? 'Admin'
      : base.globalRole === 'Active'
        ? (base.projectRole ?? 'none')
        : 'none'

  function hasRole(minRole: string): boolean {
    const minLevel = EFFECTIVE_LEVEL[minRole] ?? 99
    const curLevel = EFFECTIVE_LEVEL[effectiveAccess] ?? 0
    return curLevel >= minLevel
  }

  return {
    globalRole: base.globalRole as GlobalRole | null,
    projectRole: base.projectRole as ProjectRole | null,
    effectiveAccess,
    loading: base.loading,
    hasRole,
  }
}

interface RoleGuardProps {
  minRole: string
  children: ReactNode
  fallback?: ReactNode
}

export default function RoleGuard({ minRole, children, fallback }: RoleGuardProps) {
  const { effectiveAccess, loading, hasRole } = useUserRole()

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>
  }

  if (!hasRole(minRole)) {
    return (
      <>
        {fallback ?? (
          <div className="p-8 text-center">
            <h2 className="text-xl font-semibold text-red-600">Access Denied</h2>
            <p className="text-gray-500 mt-2">
              You need <span className="font-medium">{minRole}</span> or higher access to view this page.
              Your current access: <span className="font-medium">{effectiveAccess}</span>
            </p>
          </div>
        )}
      </>
    )
  }

  return <>{children}</>
}
