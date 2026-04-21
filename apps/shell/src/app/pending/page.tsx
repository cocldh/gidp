'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function PendingPage() {
  const supabase = createClient()
  const router = useRouter()

  async function handleCheck() {
    const res = await fetch('/api/auth/check-role')
    if (res.status === 401) {
      router.push('/login')
      return
    }
    const { role } = await res.json()
    if (role && role !== 'Pending') {
      router.push('/project')
    } else {
      alert('Your account is still pending approval. Please wait for an administrator to approve your request.')
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">Awaiting Approval</h1>
        <p className="text-gray-500 text-sm mb-6">
          Your account has been registered and is pending administrator approval.
          You will be able to access the site once an admin approves your account.
        </p>

        <div className="space-y-3">
          <button
            onClick={handleCheck}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
          >
            Check Approval Status
          </button>
          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
          >
            Sign Out
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          GIDP — GS Instrument Data Platform
        </p>
      </div>
    </div>
  )
}
