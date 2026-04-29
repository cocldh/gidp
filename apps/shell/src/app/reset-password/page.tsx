'use client'

import { Suspense, useState, useEffect, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

function ResetPasswordInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase는 두 가지 형식으로 토큰을 전달함:
    // 1. PKCE flow: ?code=xxx (newer)
    // 2. Implicit flow: #access_token=xxx&type=recovery (older / some configs)
    // 에러는 querystring 또는 hash 양쪽 모두 올 수 있음

    const code = searchParams.get('code')
    const qsError = searchParams.get('error')
    const qsErrorDesc = searchParams.get('error_description')

    // URL fragment는 서버로 전송되지 않으므로 클라이언트에서 직접 파싱
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    const hashParams = new URLSearchParams(hash)
    const hashError = hashParams.get('error')
    const hashErrorDesc = hashParams.get('error_description')
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    const tokenType = hashParams.get('type')

    const errCode = qsError || hashError
    const errDesc = qsErrorDesc || hashErrorDesc

    if (errCode) {
      if (errCode === 'access_denied' && hashParams.get('error_code') === 'otp_expired') {
        setError('링크가 만료되었습니다. 비밀번호 재설정을 다시 요청해주세요.')
      } else {
        setError(errDesc?.replace(/\+/g, ' ') ?? '유효하지 않은 링크입니다. 다시 요청해주세요.')
      }
      return
    }

    if (code) {
      // PKCE flow
      supabase.auth.exchangeCodeForSession(code).then(({ error: err }) => {
        if (err) {
          setError('링크가 만료되었거나 이미 사용된 링크입니다. 다시 요청해주세요.')
        } else {
          setReady(true)
        }
      })
      return
    }

    if (accessToken && refreshToken && tokenType === 'recovery') {
      // Implicit flow
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: err }) => {
        if (err) {
          setError('링크가 만료되었거나 이미 사용된 링크입니다. 다시 요청해주세요.')
        } else {
          setReady(true)
        }
      })
      return
    }

    setError('유효하지 않은 링크입니다. 비밀번호 재설정을 다시 요청해주세요.')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.')
      return
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await supabase.auth.signOut()
    router.push('/login?info=password_reset')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f4ef]">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-center mb-1 text-[#000080]">GIDP</h1>
        <p className="text-gray-500 text-center text-sm mb-6">새 비밀번호 설정</p>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
            <div className="mt-2">
              <a href="/login" className="text-blue-600 underline text-xs">
                로그인 페이지로 돌아가기
              </a>
            </div>
          </div>
        )}

        {ready && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                새 비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="6자 이상 입력"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                새 비밀번호 확인
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="비밀번호 재입력"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? '저장 중...' : '비밀번호 변경'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f7f4ef]" />}>
      <ResetPasswordInner />
    </Suspense>
  )
}
