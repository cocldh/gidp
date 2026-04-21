'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, createSchemaClient } from '@/lib/supabase-client'
import Navbar from '@/components/Navbar'

const PAGE_SIZE = 100

interface ChangeRow {
  detail_id: number
  changed_at: string
  document_number: string
  tag_number: string | null
  field_name: string
  previous_value: string | null
  new_value: string | null
  revision_number: string  // combined display (e.g. "Aa")
  revision_type: string    // 'minor' | 'major'
  changed_by: string | null
}

export default function ChangelogPage() {
  const supabase = createSchemaClient()  // 프로젝트 스키마 적용
  const baseSupabase = createClient()    // auth 전용
  const router = useRouter()

  const [rows, setRows] = useState<ChangeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [baselineMsg, setBaselineMsg] = useState('')
  const [settingBaseline, setSettingBaseline] = useState(false)

  // Filters
  const [filterDoc, setFilterDoc] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [filterField, setFilterField] = useState('')
  const [filterAuthor, setFilterAuthor] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await baseSupabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await baseSupabase
        .from('user_profile')
        .select('role')
        .eq('id', user.id)
        .single()

      const globalRole = profile?.role ?? ''

      // Global Admin always allowed
      if (globalRole === 'Admin') {
        setIsAdmin(true)
        setAuthorized(true)
        return
      }

      // Active users: check project role (Editor+ can access Change Log)
      if (globalRole === 'Active') {
        const schema = typeof document !== 'undefined'
          ? (() => { const m = document.cookie.match(/(?:^|;\s*)iss_project=([^;]+)/); return m ? decodeURIComponent(m[1]) : null })()
          : null

        if (schema) {
          const { data: project } = await baseSupabase
            .from('project')
            .select('project_id')
            .eq('project_code', schema)
            .single()

          if (project) {
            const { data: upr } = await baseSupabase
              .from('user_project_role')
              .select('role')
              .eq('user_id', user.id)
              .eq('project_id', project.project_id)
              .single()

            const pRole = upr?.role ?? ''
            setAuthorized(pRole === 'ProjectAdmin' || pRole === 'Editor')
            return
          }
        }
      }

      setAuthorized(false)
    }
    checkAuth()
  }, [])

  const loadData = useCallback(async (p = 0) => {
    setLoading(true)
    setPage(p)

    let query = supabase
      .from('document_revision_detail')
      .select(`
        detail_id,
        changed_at,
        document_number,
        tag_number,
        field_name,
        previous_value,
        new_value,
        changed_by,
        document_revision!inner(revision_number, revision_type)
      `)
      .order('changed_at', { ascending: false })
      .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)

    if (filterDoc.trim()) query = query.ilike('document_number', `%${filterDoc.trim()}%`)
    if (filterTag.trim()) query = query.ilike('tag_number', `%${filterTag.trim()}%`)
    if (filterField.trim()) query = query.ilike('field_name', `%${filterField.trim()}%`)
    if (filterAuthor.trim()) query = query.ilike('changed_by', `%${filterAuthor.trim()}%`)
    if (filterDateFrom.trim()) query = query.gte('changed_at', filterDateFrom.trim())
    if (filterDateTo.trim()) query = query.lte('changed_at', filterDateTo.trim() + 'T23:59:59')

    const { data, error } = await query

    if (error) {
      console.error('Changelog load error:', error)
      setRows([])
    } else {
      const mapped: ChangeRow[] = (data ?? []).map((r: any) => ({
        detail_id: r.detail_id,
        changed_at: r.changed_at,
        document_number: r.document_number,
        tag_number: r.tag_number,
        field_name: r.field_name,
        previous_value: r.previous_value,
        new_value: r.new_value,
        changed_by: r.changed_by,
        revision_number: r.document_revision?.revision_number ?? '',
        revision_type: r.document_revision?.revision_type ?? '',
      }))
      // The range fetches PAGE_SIZE+1 to detect hasMore
      setHasMore(mapped.length > PAGE_SIZE)
      setRows(mapped.slice(0, PAGE_SIZE))
    }

    setLoading(false)
  }, [filterDoc, filterTag, filterField, filterAuthor, filterDateFrom, filterDateTo])

  useEffect(() => {
    if (authorized) loadData(0)
  }, [authorized])

  async function handleSetBaseline() {
    if (!confirm('Set baseline? This will clear all "previous_value" tracking for every document value, treating the current state as the new baseline.')) return
    setSettingBaseline(true)
    setBaselineMsg('')
    const { error } = await supabase
      .from('document_value_change')
      .delete()
      .neq('document_id', 0)
    if (error) {
      setBaselineMsg(`Error: ${error.message}`)
    } else {
      setBaselineMsg('Baseline set successfully. All change tracking has been reset.')
    }
    setSettingBaseline(false)
    setTimeout(() => setBaselineMsg(''), 5000)
  }

  function handleSearch() { loadData(0) }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter') handleSearch() }

  function formatDate(iso: string) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  if (authorized === null) return <div className="min-h-screen"><Navbar /><div className="p-8 text-gray-500">Loading...</div></div>
  if (authorized === false) return <div className="min-h-screen"><Navbar /><div className="p-8 text-red-500">Access denied.</div></div>

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Change Log</h1>
          {isAdmin && (
            <div className="flex items-center gap-3">
              {baselineMsg && (
                <span className={`text-sm ${baselineMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                  {baselineMsg}
                </span>
              )}
              <button
                onClick={handleSetBaseline}
                disabled={settingBaseline}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
              >
                {settingBaseline ? 'Setting Baseline...' : 'Set Baseline'}
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Document Number..."
              value={filterDoc}
              onChange={e => setFilterDoc(e.target.value)}
              onKeyDown={handleKeyDown}
              className="px-3 py-2 border border-gray-300 rounded text-sm min-w-40"
            />
            <input
              type="text"
              placeholder="Tag Number..."
              value={filterTag}
              onChange={e => setFilterTag(e.target.value)}
              onKeyDown={handleKeyDown}
              className="px-3 py-2 border border-gray-300 rounded text-sm min-w-36"
            />
            <input
              type="text"
              placeholder="Field Name..."
              value={filterField}
              onChange={e => setFilterField(e.target.value)}
              onKeyDown={handleKeyDown}
              className="px-3 py-2 border border-gray-300 rounded text-sm min-w-36"
            />
            <input
              type="text"
              placeholder="Author..."
              value={filterAuthor}
              onChange={e => setFilterAuthor(e.target.value)}
              onKeyDown={handleKeyDown}
              className="px-3 py-2 border border-gray-300 rounded text-sm min-w-32"
            />
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
              title="From date"
            />
            <span className="self-center text-gray-400 text-sm">~</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
              title="To date"
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? 'Loading...' : 'Search'}
            </button>
            <button
              onClick={() => {
                setFilterDoc('')
                setFilterTag('')
                setFilterField('')
                setFilterAuthor('')
                setFilterDateFrom('')
                setFilterDateTo('')
              }}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 text-sm"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center text-gray-500 py-8">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No records found</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Date/Time</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Document</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Tag</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Field</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Previous Value</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">New Value</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Rev</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Type</th>
                  <th className="px-3 py-2 text-left border-b whitespace-nowrap font-medium text-gray-600">Author</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.detail_id} className="hover:bg-gray-50 border-b border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatDate(row.changed_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{row.document_number}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.tag_number ?? ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{row.field_name}</td>
                    <td className="px-3 py-2 max-w-48 text-gray-500 break-words">{row.previous_value ?? <span className="italic text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 max-w-48 break-words">{row.new_value ?? <span className="italic text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${row.revision_type === 'major' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {row.revision_number}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500 text-xs capitalize">{row.revision_type}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{row.changed_by ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="px-4 py-2 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
              <span>Page {page + 1} — {rows.length} rows{hasMore ? '+' : ''}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => loadData(page - 1)}
                  disabled={page === 0 || loading}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  Prev
                </button>
                <button
                  onClick={() => loadData(page + 1)}
                  disabled={!hasMore || loading}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
