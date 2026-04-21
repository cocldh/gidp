'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@gidp/auth/client';
import type {
  GlobalRole,
  ModuleAccess,
  ModuleName,
  ProjectRole,
} from '@gidp/auth';
import { accessAtLeast } from '@gidp/auth';

export interface UserRoleState {
  userId: string | null;
  email: string | null;
  globalRole: GlobalRole | null;
  projectRole: ProjectRole | null;
  moduleAccess: ModuleAccess;
  loading: boolean;
  hasModuleAccess: (min: ModuleAccess) => boolean;
  isProjectRole: (min: ProjectRole) => boolean;
}

const PROJECT_RANK: Record<ProjectRole, number> = {
  Viewer: 1,
  Editor: 2,
  ProjectAdmin: 3,
};

/**
 * Client-side hook. Fetches signed-in user's global role + their access for
 * the given project+module. Global Admins always resolve to 'Admin' access.
 */
export function useUserRole(
  projectId: number | null,
  module: ModuleName,
): UserRoleState {
  const [state, setState] = useState<UserRoleState>({
    userId: null,
    email: null,
    globalRole: null,
    projectRole: null,
    moduleAccess: 'None',
    loading: true,
    hasModuleAccess: () => false,
    isProjectRole: () => false,
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabaseClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false }));
        }
        return;
      }

      const { data: profile } = await supabase
        .from('user_profile')
        .select('email, role')
        .eq('id', user.id)
        .single();

      const globalRole = ((profile?.role ?? 'Pending') as GlobalRole) || 'Pending';

      let projectRole: ProjectRole | null = null;
      let moduleAccess: ModuleAccess = globalRole === 'Admin' ? 'Admin' : 'None';

      if (projectId != null && globalRole !== 'Pending') {
        const [{ data: upr }, { data: upm }] = await Promise.all([
          supabase
            .from('user_project_role')
            .select('role')
            .eq('user_id', user.id)
            .eq('project_id', projectId)
            .maybeSingle(),
          supabase
            .from('user_project_module')
            .select('access')
            .eq('user_id', user.id)
            .eq('project_id', projectId)
            .eq('module', module)
            .maybeSingle(),
        ]);
        projectRole = (upr?.role as ProjectRole | undefined) ?? null;
        if (globalRole !== 'Admin') {
          moduleAccess = (upm?.access as ModuleAccess | undefined) ?? 'None';
        }
      }

      if (cancelled) return;

      setState({
        userId: user.id,
        email: profile?.email ?? user.email ?? null,
        globalRole,
        projectRole,
        moduleAccess,
        loading: false,
        hasModuleAccess: (min) => accessAtLeast(moduleAccess, min),
        isProjectRole: (min) =>
          globalRole === 'Admin' ||
          (projectRole != null && PROJECT_RANK[projectRole] >= PROJECT_RANK[min]),
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, module]);

  return state;
}
