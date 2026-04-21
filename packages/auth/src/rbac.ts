import { createServerSupabaseClient } from './server';
import type {
  GlobalRole,
  ModuleAccess,
  ModuleName,
  ProjectRole,
  UserProfile,
} from './types';

export interface AuthContext {
  userId: string;
  email: string;
  globalRole: GlobalRole;
  profile: UserProfile;
}

/**
 * Load the signed-in user's session + user_profile row. Returns null if
 * unauthenticated or if the profile row has not been provisioned yet.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profile')
    .select('id, email, display_name, role, username')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  return {
    userId: user.id,
    email: profile.email,
    globalRole: profile.role,
    profile: profile as UserProfile,
  };
}

/**
 * RPC-backed module access check. Calls the `has_module_access` function
 * defined in 005_rls_policies.sql — authoritative because it uses the same
 * SECURITY DEFINER helper the RLS policies rely on.
 */
export async function hasModuleAccess(
  projectId: number,
  module: ModuleName,
  minAccess: ModuleAccess = 'Viewer',
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('has_module_access', {
    p_project_id: projectId,
    p_module: module,
    p_min_access: minAccess,
  });
  if (error) return false;
  return data === true;
}

export async function hasProjectRole(
  projectId: number,
  minRole: ProjectRole = 'Viewer',
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('has_project_role', {
    p_project_id: projectId,
    p_min_role: minRole,
  });
  if (error) return false;
  return data === true;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

/** Throws AuthError(401) if unauthenticated, AuthError(403) if access is below minAccess. */
export async function requireModuleAccess(
  projectId: number,
  module: ModuleName,
  minAccess: ModuleAccess = 'Viewer',
): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthError('Not authenticated', 401);
  const ok = await hasModuleAccess(projectId, module, minAccess);
  if (!ok) {
    throw new AuthError(
      `Requires ${minAccess} access to ${module} on project ${projectId}`,
      403,
    );
  }
  return ctx;
}

export async function requireProjectRole(
  projectId: number,
  minRole: ProjectRole = 'Viewer',
): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthError('Not authenticated', 401);
  const ok = await hasProjectRole(projectId, minRole);
  if (!ok) {
    throw new AuthError(
      `Requires ${minRole} role on project ${projectId}`,
      403,
    );
  }
  return ctx;
}
