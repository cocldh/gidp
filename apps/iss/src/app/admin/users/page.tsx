'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import RoleGuard from '@/components/RoleGuard'
import { createClient } from '@/lib/supabase-client'
import type { UserProfile, GlobalRole, ProjectRole, UserProjectRole } from '@/lib/types'

interface Project {
  project_id: number
  project_name: string
  project_code: string
}

export default function UsersPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <RoleGuard minRole="Admin">
          <UsersContent />
        </RoleGuard>
      </main>
    </div>
  )
}

function UsersContent() {
  const supabase = createClient()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionUser, setActionUser] = useState<string | null>(null)

  // Username inline edit state
  const [editingUsernameId, setEditingUsernameId] = useState<string | null>(null)
  const [editingUsernameValue, setEditingUsernameValue] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [usernameLoading, setUsernameLoading] = useState(false)

  // Display Name inline edit state
  const [editingDisplayNameId, setEditingDisplayNameId] = useState<string | null>(null)
  const [editingDisplayNameValue, setEditingDisplayNameValue] = useState('')
  const [displayNameLoading, setDisplayNameLoading] = useState(false)

  // Project role assignment state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [projectRoles, setProjectRoles] = useState<(UserProjectRole & { project_name: string })[]>([])
  const [assignProjectId, setAssignProjectId] = useState<number | ''>('')
  const [assignRole, setAssignRole] = useState<ProjectRole>('Editor')
  const [assignLoading, setAssignLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null))
    loadUsers()
    loadProjects()
  }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase
      .from('user_profile')
      .select('*')
      .order('created_at')
    if (data) setUsers(data)
    setLoading(false)
  }

  async function loadProjects() {
    const { data } = await supabase
      .from('project')
      .select('project_id, project_name, project_code')
      .order('project_id')
    if (data) setProjects(data)
  }

  async function loadProjectRoles(userId: string) {
    const { data, error } = await supabase
      .from('user_project_role')
      .select('*')
      .eq('user_id', userId)
      .order('assigned_at')
    if (error) {
      console.error('loadProjectRoles error:', error)
      setProjectRoles([])
      return
    }
    if (data) {
      setProjectRoles(data.map((r: any) => ({
        ...r,
        project_name: projects.find(p => p.project_id === r.project_id)?.project_name ?? String(r.project_id),
      })))
    } else {
      setProjectRoles([])
    }
  }

  function startEditUsername(userId: string, current: string | null | undefined) {
    setEditingUsernameId(userId)
    setEditingUsernameValue(current ?? '')
    setUsernameError('')
  }

  function cancelEditUsername() {
    setEditingUsernameId(null)
    setEditingUsernameValue('')
    setUsernameError('')
  }

  function startEditDisplayName(userId: string, current: string | null | undefined) {
    setEditingDisplayNameId(userId)
    setEditingDisplayNameValue(current ?? '')
  }

  function cancelEditDisplayName() {
    setEditingDisplayNameId(null)
    setEditingDisplayNameValue('')
  }

  async function saveDisplayName(userId: string) {
    setDisplayNameLoading(true)
    const res = await fetch('/api/admin/update-display-name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, displayName: editingDisplayNameValue }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      alert(error ?? 'Error')
      setDisplayNameLoading(false)
      return
    }
    setEditingDisplayNameId(null)
    setEditingDisplayNameValue('')
    await loadUsers()
    setDisplayNameLoading(false)
  }

  async function saveUsername(userId: string) {
    setUsernameLoading(true)
    setUsernameError('')
    const res = await fetch('/api/admin/update-username', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username: editingUsernameValue }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setUsernameError(error ?? 'Error')
      setUsernameLoading(false)
      return
    }
    setEditingUsernameId(null)
    setEditingUsernameValue('')
    await loadUsers()
    setUsernameLoading(false)
  }

  async function changeGlobalRole(userId: string, newRole: GlobalRole) {
    const { error } = await supabase
      .from('user_profile')
      .update({ role: newRole })
      .eq('id', userId)
    if (error) alert(`Error: ${error.message}`)
    else loadUsers()
  }

  async function approveUser(userId: string) {
    setActionUser(userId)
    await changeGlobalRole(userId, 'Active')
    setActionUser(null)
  }

  async function deleteUser(userId: string, email: string, label: string) {
    if (!confirm(`${label}\n\n${email}\n\n이 작업은 되돌릴 수 없습니다.`)) return
    setActionUser(userId)
    const res = await fetch('/api/admin/delete-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const body = await res.json(); msg = body?.error ?? msg } catch {}
      alert(`사용자 삭제 실패: ${msg}`)
    } else {
      loadUsers()
      if (selectedUserId === userId) {
        setSelectedUserId(null)
        setProjectRoles([])
      }
    }
    setActionUser(null)
  }

  async function assignProjectRole() {
    if (!selectedUserId || !assignProjectId) return
    setAssignLoading(true)
    const { error } = await supabase
      .from('user_project_role')
      .upsert({
        user_id: selectedUserId,
        project_id: assignProjectId,
        role: assignRole,
        assigned_by: myId,
      }, { onConflict: 'user_id,project_id' })
    if (error) alert(`Error: ${error.message}`)
    else await loadProjectRoles(selectedUserId)
    setAssignLoading(false)
  }

  async function removeProjectRole(uprId: number) {
    const { error } = await supabase
      .from('user_project_role')
      .delete()
      .eq('id', uprId)
    if (error) alert(`Error: ${error.message}`)
    else if (selectedUserId) await loadProjectRoles(selectedUserId)
  }

  async function updateProjectRole(uprId: number, newRole: ProjectRole) {
    const { error } = await supabase
      .from('user_project_role')
      .update({ role: newRole })
      .eq('id', uprId)
    if (error) alert(`Error: ${error.message}`)
    else if (selectedUserId) await loadProjectRoles(selectedUserId)
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId)
    loadProjectRoles(userId)
    setAssignProjectId('')
  }

  if (loading) {
    return <div className="text-gray-500">Loading users...</div>
  }

  const pendingUsers = users.filter(u => u.role === 'Pending')
  const activeUsers = users.filter(u => u.role !== 'Pending')
  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Management</h1>

      {/* Pending Approvals */}
      {pendingUsers.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-orange-700 mb-2 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white text-xs font-bold">
              {pendingUsers.length}
            </span>
            Pending Approval
          </h2>
          <div className="bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-orange-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-orange-800">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-orange-800">Requested</th>
                  <th className="px-4 py-3 text-left font-medium text-orange-800">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100">
                {pendingUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="px-4 py-3 font-medium">{user.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(user.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => approveUser(user.id)}
                          disabled={actionUser === user.id}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50 font-medium"
                        >
                          {actionUser === user.id ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => deleteUser(user.id, user.email, '이 가입 요청을 거절하고 계정을 삭제하시겠습니까?')}
                          disabled={actionUser === user.id}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50 font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Users */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-2">Active Users</h2>
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Display Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Username</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Global Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Joined</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeUsers.map((user) => (
                <tr
                  key={user.id}
                  className={`hover:bg-gray-50 cursor-pointer ${selectedUserId === user.id ? 'bg-blue-50' : ''}`}
                  onClick={() => selectUser(user.id)}
                >
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {editingDisplayNameId === user.id ? (
                      <div className="flex items-center gap-1 min-w-32">
                        <input
                          type="text"
                          value={editingDisplayNameValue}
                          onChange={e => setEditingDisplayNameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveDisplayName(user.id)
                            if (e.key === 'Escape') cancelEditDisplayName()
                          }}
                          autoFocus
                          className="px-2 py-0.5 border border-blue-400 rounded text-xs w-28 focus:outline-none"
                          placeholder="display name"
                        />
                        <button
                          onClick={() => saveDisplayName(user.id)}
                          disabled={displayNameLoading}
                          className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {displayNameLoading ? '...' : '저장'}
                        </button>
                        <button
                          onClick={cancelEditDisplayName}
                          className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded hover:bg-gray-300"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span className={`text-xs ${user.display_name ? 'text-gray-700' : 'text-gray-300'}`}>
                          {user.display_name || '—'}
                        </span>
                        <button
                          onClick={() => startEditDisplayName(user.id, user.display_name)}
                          className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-xs text-blue-500 hover:text-blue-700"
                          title="display name 편집"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {editingUsernameId === user.id ? (
                      <div className="flex flex-col gap-1 min-w-32">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingUsernameValue}
                            onChange={e => { setEditingUsernameValue(e.target.value); setUsernameError('') }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveUsername(user.id)
                              if (e.key === 'Escape') cancelEditUsername()
                            }}
                            autoFocus
                            className="px-2 py-0.5 border border-blue-400 rounded text-xs font-mono w-28 focus:outline-none"
                            placeholder="username"
                          />
                          <button
                            onClick={() => saveUsername(user.id)}
                            disabled={usernameLoading}
                            className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {usernameLoading ? '...' : '저장'}
                          </button>
                          <button
                            onClick={cancelEditUsername}
                            className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded hover:bg-gray-300"
                          >
                            취소
                          </button>
                        </div>
                        {usernameError && (
                          <span className="text-xs text-red-500">{usernameError}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span className={`font-mono text-xs ${user.username ? 'text-gray-700' : 'text-gray-300'}`}>
                          {user.username || '—'}
                        </span>
                        <button
                          onClick={() => startEditUsername(user.id, user.username)}
                          className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-xs text-blue-500 hover:text-blue-700"
                          title="username 편집"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <select
                      value={user.role}
                      onChange={(e) => changeGlobalRole(user.id, e.target.value as GlobalRole)}
                      disabled={user.id === myId}
                      className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
                    >
                      <option value="Active">Active</option>
                      <option value="Admin">Admin</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {user.id !== myId ? (
                      <button
                        onClick={() => deleteUser(user.id, user.email, '이 사용자의 접근 권한을 삭제하시겠습니까?')}
                        disabled={actionUser === user.id}
                        className="px-3 py-1.5 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 disabled:opacity-50 font-medium border border-red-200"
                      >
                        {actionUser === user.id ? '...' : 'Remove'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">본인</span>
                    )}
                  </td>
                </tr>
              ))}
              {activeUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">No active users</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">{activeUsers.length} active users — 행을 클릭하면 프로젝트 역할을 관리할 수 있습니다.</p>
      </div>

      {/* Project Role Assignment */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-2">Project Role Assignment</h2>
        {!selectedUser ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-400 text-sm">
            위 목록에서 사용자를 선택하세요.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>사용자:</span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">{selectedUser.email}</span>
              <span className="text-gray-400">({selectedUser.role})</span>
            </div>

            {/* Current project roles */}
            <div className="overflow-hidden rounded border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Project</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Assigned</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {projectRoles.map((pr) => (
                    <tr key={pr.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{pr.project_name}</td>
                      <td className="px-3 py-2">
                        <select
                          value={pr.role}
                          onChange={e => updateProjectRole(pr.id, e.target.value as ProjectRole)}
                          className="px-2 py-0.5 border border-gray-300 rounded text-xs"
                        >
                          <option value="ProjectAdmin">ProjectAdmin</option>
                          <option value="Editor">Editor</option>
                          <option value="Viewer">Viewer</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-xs">
                        {new Date(pr.assigned_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => removeProjectRole(pr.id)}
                          className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 border border-red-200"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {projectRoles.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-gray-400">
                        이 사용자에게 할당된 프로젝트 역할이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Assign new role */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <span className="text-sm text-gray-600 whitespace-nowrap">프로젝트 역할 추가:</span>
              <select
                value={assignProjectId}
                onChange={e => setAssignProjectId(e.target.value ? Number(e.target.value) : '')}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm flex-1 max-w-48"
              >
                <option value="">프로젝트 선택...</option>
                {projects.map(p => (
                  <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
                ))}
              </select>
              <select
                value={assignRole}
                onChange={e => setAssignRole(e.target.value as ProjectRole)}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="ProjectAdmin">ProjectAdmin</option>
                <option value="Editor">Editor</option>
                <option value="Viewer">Viewer</option>
              </select>
              <button
                onClick={assignProjectRole}
                disabled={!assignProjectId || assignLoading}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 font-medium whitespace-nowrap"
              >
                {assignLoading ? '...' : '+ Assign'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
