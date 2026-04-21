export type GlobalRole = 'Pending' | 'Active' | 'Admin';
export type ProjectRole = 'ProjectAdmin' | 'Editor' | 'Viewer';
export type ModuleName = 'iss' | 'idx' | 'drawings';
export type ModuleAccess = 'None' | 'Viewer' | 'Editor' | 'Admin';

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: GlobalRole;
  username: string | null;
}

export interface ProjectRoleRow {
  project_id: number;
  role: ProjectRole;
}

export interface ModuleAccessRow {
  project_id: number;
  module: ModuleName;
  access: ModuleAccess;
}

const ACCESS_RANK: Record<ModuleAccess, number> = {
  None: 0,
  Viewer: 1,
  Editor: 2,
  Admin: 3,
};

export function accessAtLeast(have: ModuleAccess, need: ModuleAccess): boolean {
  return ACCESS_RANK[have] >= ACCESS_RANK[need];
}
