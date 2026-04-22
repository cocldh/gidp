'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition-colors"
    >
      Sign Out
    </button>
  )
}
