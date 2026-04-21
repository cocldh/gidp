'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import RoleGuard from '@/components/RoleGuard'
import { createClient } from '@/lib/supabase-client'
import type { FieldDef } from '@/lib/types'

export default function MergePage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <RoleGuard minRole="Admin">
          <FieldManagementContent />
        </RoleGuard>
      </main>
    </div>
  )
}

type Tab = 'rename' | 'merge'

function FieldManagementContent() {
  const supabase = createClient()
  const [fields, setFields] = useState<FieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('rename')

  // Merge state
  const [sourceId, setSourceId] = useState<number | ''>('')
  const [targetId, setTargetId] = useState<number | ''>('')
  const [merging, setMerging] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')

  // Rename state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameMessage, setRenameMessage] = useState('')

  useEffect(() => {
    loadFields()
  }, [])

  async function loadFields() {
    setLoading(true)
    const { data } = await supabase
      .from('field_def')
      .select('*')
      .order('field_name')
    if (data) setFields(data)
    setLoading(false)
  }

  const filtered = fields.filter((f) =>
    f.field_name.toLowerCase().includes(search.toLowerCase())
  )

  // ── Merge ──
  async function handleMerge() {
    if (sourceId === '' || targetId === '') return
    if (sourceId === targetId) {
      setMergeMessage('Source and target must be different.')
      return
    }

    const sourceName = fields.find((f) => f.field_id === sourceId)?.field_name
    const targetName = fields.find((f) => f.field_id === targetId)?.field_name

    if (!confirm(`Merge "${sourceName}" into "${targetName}"?\n\nThis will move all values and mappings from the source field to the target field, then delete the source field. This action cannot be undone.`)) {
      return
    }

    setMerging(true)
    setMergeMessage('')

    const { error } = await supabase.rpc('merge_fields', {
      source_field_id: sourceId,
      target_field_id: targetId,
    })

    if (error) {
      setMergeMessage(`Error: ${error.message}`)
    } else {
      setMergeMessage(`Successfully merged "${sourceName}" into "${targetName}"`)
      setSourceId('')
      setTargetId('')
      loadFields()
    }
    setMerging(false)
  }

  // ── Rename ──
  function startEditing(field: FieldDef) {
    setEditingId(field.field_id)
    setEditingName(field.field_name)
    setRenameMessage('')
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName('')
  }

  async function handleRename(fieldId: number, oldName: string) {
    const newName = editingName.trim()
    if (!newName || newName === oldName) {
      cancelEditing()
      return
    }

    // Duplicate check
    const duplicate = fields.find(
      (f) => f.field_name.toLowerCase() === newName.toLowerCase() && f.field_id !== fieldId
    )
    if (duplicate) {
      setRenameMessage(`Error: Field name "${newName}" already exists (id=${duplicate.field_id})`)
      return
    }

    if (!confirm(`Rename field?\n\n"${oldName}"  →  "${newName}"\n(id=${fieldId})`)) {
      return
    }

    setRenaming(true)
    setRenameMessage('')

    const { error } = await supabase
      .from('field_def')
      .update({ field_name: newName })
      .eq('field_id', fieldId)

    if (error) {
      setRenameMessage(`Error: ${error.message}`)
    } else {
      setRenameMessage(`Renamed: "${oldName}" → "${newName}"`)
      setEditingId(null)
      setEditingName('')
      loadFields()
    }
    setRenaming(false)
  }

  if (loading) {
    return <div className="text-gray-500">Loading fields...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Field Management</h1>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveTab('rename')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'rename'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Rename Field
        </button>
        <button
          onClick={() => setActiveTab('merge')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'merge'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Merge Fields
        </button>
      </div>

      {/* Merge controls */}
      {activeTab === 'merge' && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <p className="text-sm text-gray-500 mb-3">
            Merge two fields into one. The source field&apos;s values and mappings will be moved to the target field, then the source field will be deleted.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Field (will be deleted)
              </label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value ? parseInt(e.target.value) : '')}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="">Select source...</option>
                {fields.map((f) => (
                  <option key={f.field_id} value={f.field_id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Field (will keep)
              </label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value ? parseInt(e.target.value) : '')}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="">Select target...</option>
                {fields.map((f) => (
                  <option key={f.field_id} value={f.field_id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                onClick={handleMerge}
                disabled={sourceId === '' || targetId === '' || merging}
                className="w-full px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {merging ? 'Merging...' : 'Merge Fields'}
              </button>
            </div>
          </div>
          {mergeMessage && (
            <p className={`mt-3 text-sm ${mergeMessage.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {mergeMessage}
            </p>
          )}
        </div>
      )}

      {/* Rename instructions */}
      {activeTab === 'rename' && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <p className="text-sm text-gray-500">
            Click a field name in the table below to rename it. Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">Enter</kbd> to save or <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs">Esc</kbd> to cancel.
          </p>
          {renameMessage && (
            <p className={`mt-2 text-sm ${renameMessage.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {renameMessage}
            </p>
          )}
        </div>
      )}

      {/* Field list */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="bg-white rounded-lg shadow overflow-auto max-h-[50vh]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">ID</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Field Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Data Kind</th>
              {activeTab === 'rename' && (
                <th className="px-4 py-2 text-left font-medium text-gray-600 w-20">Action</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((f) => (
              <tr key={f.field_id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-400">{f.field_id}</td>
                <td className="px-4 py-2">
                  {activeTab === 'rename' && editingId === f.field_id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(f.field_id, f.field_name)
                        if (e.key === 'Escape') cancelEditing()
                      }}
                      autoFocus
                      disabled={renaming}
                      className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <span
                      className={activeTab === 'rename' ? 'cursor-pointer hover:text-blue-600' : ''}
                      onClick={() => activeTab === 'rename' && startEditing(f)}
                    >
                      {f.field_name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">{f.data_kind}</td>
                {activeTab === 'rename' && (
                  <td className="px-4 py-2">
                    {editingId === f.field_id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleRename(f.field_id, f.field_name)}
                          disabled={renaming}
                          className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEditing}
                          disabled={renaming}
                          className="px-2 py-0.5 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(f)}
                        className="px-2 py-0.5 text-blue-600 hover:text-blue-800 text-xs"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {filtered.length} of {fields.length} fields
      </p>
    </div>
  )
}
