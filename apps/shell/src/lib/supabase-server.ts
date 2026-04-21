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
