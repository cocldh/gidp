import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/project'

  if (code) {
    const supabase = await createClient()
    const { data: authData, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && authData.user) {
      const userId = authData.user.id
      const userEmail = authData.user.email ?? ''

      const adminClient = createAdminClient()

      // Username from sign-up metadata (if provided)
      const usernameFromMeta = authData.user.user_metadata?.username as string | undefined

      // Fetch profile (trigger may have already created it with Pending role)
      let { data: profile } = await adminClient
        .from('user_profile')
        .select('id, role')
        .eq('id', userId)
        .single()

      // Fallback: create profile if trigger didn't fire
      if (!profile) {
        await adminClient.from('user_profile').insert({
          id: userId,
          email: userEmail,
          role: 'Pending',
          ...(usernameFromMeta ? { username: usernameFromMeta } : {}),
        })
        profile = { id: userId, role: 'Pending' }
      } else if (usernameFromMeta) {
        // Update username if not yet set (e.g. email confirmation flow)
        const { data: existing } = await adminClient
          .from('user_profile')
          .select('username')
          .eq('id', userId)
          .single()
        if (!existing?.username) {
          await adminClient
            .from('user_profile')
            .update({ username: usernameFromMeta })
            .eq('id', userId)
        }
      }

      if (profile.role === 'Pending') {
        // New user hitting callback for the first time: notify admin
        // (confirmation link is single-use, so this fires exactly once per sign-up)
        try {
          await fetch(`${origin}/api/notify-admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail }),
          })
        } catch (e) {
          console.error('[auth/callback] notify-admin failed:', e)
        }

        return NextResponse.redirect(`${origin}/pending`)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
