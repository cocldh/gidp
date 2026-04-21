import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/** 현재 선택된 프로젝트 스키마를 쿠키에서 읽어 반환 (클라이언트 전용) */
export function getProjectSchema(): string {
  if (typeof document === 'undefined') return 'public'
  const match = document.cookie.match(/(?:^|;\s*)iss_project=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : 'public'
}

/**
 * 프로젝트 스키마가 적용된 Supabase 클라이언트 반환.
 * .from() 쿼리에 사용. auth 호출에는 createClient()를 그대로 사용.
 */
export function createSchemaClient() {
  const base = createClient()
  const schema = getProjectSchema()
  if (!schema || schema === 'public') return base
  return (base as any).schema(schema) as ReturnType<typeof createClient>
}
