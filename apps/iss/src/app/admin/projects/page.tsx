'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import RoleGuard from '@/components/RoleGuard'
import { createClient } from '@/lib/supabase-client'

interface Project {
  project_id: number
  project_code: string
  project_name: string
  description: string | null
  created_at: string
}

export default function ProjectsPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <RoleGuard minRole="Admin">
          <ProjectsContent />
        </RoleGuard>
      </main>
    </div>
  )
}

function ProjectsContent() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const [code, setCode]        = useState('')
  const [name, setName]        = useState('')
  const [desc, setDesc]        = useState('')
  const [creating, setCreating] = useState(false)
  const [result, setResult]    = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    const { data } = await supabase
      .from('project')
      .select('*')
      .order('project_id')
    if (data) setProjects(data)
    setLoading(false)
  }

  async function createProject() {
    if (!code.trim() || !name.trim()) return
    setCreating(true)
    setResult(null)

    const res = await fetch('/api/admin/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_code: code.trim().toLowerCase(),
        project_name: name.trim(),
        description:  desc.trim() || null,
      }),
    })

    const json = await res.json()
    if (res.ok) {
      setResult({ ok: true, msg: json.message })
      setCode('')
      setName('')
      setDesc('')
      await loadProjects()
    } else {
      setResult({ ok: false, msg: json.error })
    }
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Project Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          새 프로젝트를 생성하면 스키마·테이블·기본 필드가 자동으로 설정됩니다.
        </p>
      </div>

      {/* Create Form */}
      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">새 프로젝트 생성</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Project Code <span className="text-red-500">*</span></label>
            <input
              type="text"
              placeholder="예: project_a"
              value={code}
              onChange={e => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">소문자·숫자·언더바만 사용 가능</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Project Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              placeholder="예: Project Alpha"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <input
            type="text"
            placeholder="프로젝트 설명 (선택)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={createProject}
            disabled={creating || !code.trim() || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? '생성 중...' : '+ 프로젝트 생성'}
          </button>
          {result && (
            <span className={`text-sm ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
              {result.ok ? '✓' : '✗'} {result.msg}
            </span>
          )}
        </div>
      </div>

      {/* Projects List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">등록된 프로젝트 ({projects.length})</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map(p => (
                <tr key={p.project_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{p.project_code}</td>
                  <td className="px-4 py-3 font-medium">{p.project_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.description || '-'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
