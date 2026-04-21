'use client';

import type { ReactNode } from 'react';
import type { ModuleAccess, ModuleName } from '@gidp/auth';
import { useUserRole } from './useUserRole';

export interface RoleGuardProps {
  projectId: number | null;
  module: ModuleName;
  minAccess: ModuleAccess;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGuard({
  projectId,
  module,
  minAccess,
  children,
  fallback,
}: RoleGuardProps) {
  const { loading, moduleAccess, hasModuleAccess } = useUserRole(projectId, module);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  if (!hasModuleAccess(minAccess)) {
    return (
      <>
        {fallback ?? (
          <div className="p-8 text-center">
            <h2 className="text-xl font-semibold text-red-600">Access Denied</h2>
            <p className="text-gray-500 mt-2">
              You need <span className="font-medium">{minAccess}</span> access to {module}.
              Current: <span className="font-medium">{moduleAccess}</span>
            </p>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}

export default RoleGuard;
