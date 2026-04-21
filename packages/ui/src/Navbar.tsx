'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@gidp/auth/client';
import type { ModuleName } from '@gidp/auth';
import { useUserRole } from './useUserRole';

export interface NavLink {
  href: string;
  label: string;
  /** Optional gate — link is hidden unless predicate returns true. */
  when?: (role: {
    isGlobalAdmin: boolean;
    hasModuleAccess: (min: 'Viewer' | 'Editor' | 'Admin') => boolean;
    isProjectRole: (min: 'Viewer' | 'Editor' | 'ProjectAdmin') => boolean;
  }) => boolean;
}

export interface ModuleTab {
  module: ModuleName;
  label: string;
  /** Absolute URL (cross-app) or path (within same app). */
  href: string;
}

export interface NavbarProps {
  title: string;
  currentModule: ModuleName;
  projectId: number | null;
  projectSwitchHref?: string;
  moduleTabs?: ModuleTab[];
  links?: NavLink[];
  loginPath?: string;
}

export function Navbar({
  title,
  currentModule,
  projectId,
  projectSwitchHref = '/project',
  moduleTabs = [],
  links = [],
  loginPath = '/login',
}: NavbarProps) {
  const router = useRouter();
  const role = useUserRole(projectId, currentModule);
  const [projectLabel, setProjectLabel] = useState<string>('');

  useEffect(() => {
    if (projectId == null) {
      setProjectLabel('');
      return;
    }
    const supabase = createBrowserSupabaseClient();
    supabase
      .from('project')
      .select('project_code, project_name')
      .eq('project_id', projectId)
      .single()
      .then(({ data }) => {
        if (data) setProjectLabel(data.project_name ?? data.project_code ?? '');
      });
  }, [projectId]);

  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push(loginPath);
  };

  const isGlobalAdmin = role.globalRole === 'Admin';
  const gate = {
    isGlobalAdmin,
    hasModuleAccess: role.hasModuleAccess,
    isProjectRole: role.isProjectRole,
  };

  return (
    <nav className="bg-gray-900 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold">{title}</span>
          {moduleTabs.length > 0 && (
            <div className="hidden md:flex items-center gap-1 text-sm">
              {moduleTabs.map((tab) => {
                const active = tab.module === currentModule;
                return (
                  <Link
                    key={tab.module}
                    href={tab.href}
                    className={
                      'px-3 py-1 rounded ' +
                      (active
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white')
                    }
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          )}
          <div className="hidden md:flex items-center gap-4 text-sm">
            {links
              .filter((l) => (l.when ? l.when(gate) : true))
              .map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-gray-300">
                  {l.label}
                </Link>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {projectLabel && (
            <Link
              href={projectSwitchHref}
              className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-blue-800 hover:bg-blue-700 rounded text-xs text-blue-200"
              title="프로젝트 전환"
            >
              <span>📁</span>
              <span className="max-w-32 truncate">{projectLabel}</span>
              <span className="text-blue-400 text-xs">▼</span>
            </Link>
          )}
          {role.email && (
            <span className="hidden sm:inline text-gray-400">
              {role.email}
              <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-gray-700">
                {role.moduleAccess}
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
  );
}

export default Navbar;
