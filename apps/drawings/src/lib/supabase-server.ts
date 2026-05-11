import { cookies } from 'next/headers';

export { createServerSupabaseClient as createClient } from '@gidp/auth/server';

export const PROJECT_ID_COOKIE = 'gidp_project_id';

export async function getServerProjectId(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(PROJECT_ID_COOKIE)?.value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Throws if the project cookie is absent. Use in routes that require a project. */
export async function requireServerProjectId(): Promise<number> {
  const id = await getServerProjectId();
  if (id == null) {
    throw new Error(
      'No project selected — set the gidp_project_id cookie via /project',
    );
  }
  return id;
}
