'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type Mode = 'signin' | 'signup'

const ALLOWED_RETURN_HOSTS = (process.env.NEXT_PUBLIC_ALLOWED_RETURN_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function isSafeReturnUrl(raw: string | null): string | null {
  if (!raw) return null
  // Same-origin absolute path. Reject scheme-relative ("//evil.com") and
  // backslash tricks ("/\evil.com") which some browsers parse as absolute.
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) {
    return raw
  }
  try {
    const u = new URL(raw)
    if (typeof window !== 'undefined' && u.origin === window.location.origin) {
      return raw
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return raw
    if (ALLOWED_RETURN_HOSTS.includes(u.host)) return raw
  } catch {
    // fallthrough
  }
  return null
}

function LoginInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = isSafeReturnUrl(searchParams.get('return_to'))

  const [mode, setMode] = useState<Mode>('signin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [signInInput, setSignInInput] = useState('')
  const [signInPassword, setSignInPassword] = useState('')

  const [signUpEmail, setSignUpEmail] = useState('')
  const [signUpUsername, setSignUpUsername] = useState('')
  const [signUpPassword, setSignUpPassword] = useState('')

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setInfo('')
  }

  function redirectAfterAuth() {
    // Always land on /project so the user can confirm the active project.
    // Pass return_to through so the project action can bounce back to
    // the originating tool app (cross-origin safe) once a project is set.
    if (returnTo) {
      router.push(`/project?return_to=${encodeURIComponent(returnTo)}`)
    } else {
      router.push('/project')
    }
  }

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      let loginEmail = signInInput.trim()

      if (!loginEmail.includes('@')) {
        const res = await fetch('/api/auth/lookup-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginEmail }),
        })
        if (!res.ok) {
          setError('Username을 찾을 수 없습니다.')
          setLoading(false)
          return
        }
        const json = await res.json()
        loginEmail = json.email
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: signInPassword,
      })

      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('user_profile')
          .select('role')
          .eq('id', user.id)
          .single()

        if (!profile || profile.role === 'Pending') {
          router.push('/pending')
        } else {
          redirectAfterAuth()
        }
      }
    } catch {
      setError('로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    const email = signUpEmail.trim()
    const username = signUpUsername.trim()

    if (!username) {
      setError('Username을 입력해주세요.')
      setLoading(false)
      return
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username은 영문자, 숫자, 언더바(_)만 사용 가능합니다.')
      setLoading(false)
      return
    }

    try {
      const checkRes = await fetch('/api/auth/lookup-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (checkRes.ok) {
        setError('이미 사용 중인 Username입니다.')
        setLoading(false)
        return
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: signUpPassword,
        options: { data: { username } },
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      if (signUpData.session && signUpData.user) {
        await fetch('/api/auth/save-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        })

        fetch('/api/notify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }).catch(() => {})

        router.push('/pending')
      } else {
        setInfo('확인 이메일을 발송했습니다. 이메일을 확인한 후 로그인해주세요.')
      }
    } catch {
      setError('회원가입 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f4ef]">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-center mb-1 text-[#000080]">GIDP</h1>
        <p className="text-gray-500 text-center text-sm mb-6">
          GS Instrument Data Platform
        </p>

        <div className="flex mb-6 border-b border-gray-200">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'signin'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'signup'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Sign Up
          </button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            {info}
          </div>
        )}

        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email 또는 Username
              </label>
              <input
                type="text"
                value={signInInput}
                onChange={e => setSignInInput(e.target.value)}
                required
                autoComplete="username"
                placeholder="email@example.com 또는 username"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={signInPassword}
                onChange={e => setSignInPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={signUpEmail}
                onChange={e => setSignUpEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="email@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={signUpUsername}
                onChange={e => setSignUpUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="영문자·숫자·언더바 사용 가능"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">나중에 username으로도 로그인할 수 있습니다.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={signUpPassword}
                onChange={e => setSignUpPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="••••••••"
                minLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing up...' : 'Sign Up'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f7f4ef]" />}>
      <LoginInner />
    </Suspense>
  )
}
