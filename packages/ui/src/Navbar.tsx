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
    <nav className="bg-white border-b border-gray-100 shadow-sm px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-5">
          <span className="text-lg font-bold text-[#000080]">
            {title}
          </span>
          {moduleTabs.length > 0 && (
            <div className="hidden md:flex items-center gap-1">
              {moduleTabs.map((tab) => {
                const active = tab.module === currentModule;
                return (
                  <Link
                    key={tab.module}
                    href={tab.href}
                    className={
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
                      (active
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900')
                    }
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          )}
          <div className="hidden md:flex items-center gap-1 text-sm">
            {links
              .filter((l) => (l.when ? l.when(gate) : true))
              .map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  {l.label}
                </Link>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {projectLabel && (
            <Link
              href={projectSwitchHref}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs text-blue-600 transition-colors"
              title="프로젝트 전환"
            >
              <span>📁</span>
              <span className="max-w-32 truncate">{projectLabel}</span>
              <span className="text-blue-400 text-xs">▼</span>
            </Link>
          )}
          {role.email && (
            <span className="hidden sm:inline text-gray-400 text-xs">
              {role.email}
              <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                {role.moduleAccess}
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
  );
}

export default Navbar;
