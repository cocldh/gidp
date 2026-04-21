'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import RoleGuard from '@/components/RoleGuard'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import type { Template, MappingRule } from '@/lib/types'

export default function FormsPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <RoleGuard minRole="Admin">
          <FormsContent />
        </RoleGuard>
      </main>
    </div>
  )
}

function FormsContent() {
  const baseSupabase = createClient()
  const supabase = baseSupabase.schema('iss')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [mappings, setMappings] = useState<MappingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingNameId, setEditingNameId] = useState<number | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')

  useEffect(() => {
    setProjectId(readProjectIdCookie())
  }, [])

  useEffect(() => {
    if (projectId != null) loadTemplates(projectId)
  }, [projectId])

  async function loadTemplates(pid: number) {
    setLoading(true)
    const { data } = await supabase
      .from('template')
      .select('*')
      .eq('project_id', pid)
      .order('template_code')
    if (data) setTemplates(data as Template[])
    setLoading(false)
  }

  async function selectTemplate(t: Template) {
    if (projectId == null) return
    setSelectedTemplate(t)
    const { data } = await supabase
      .from('mapping_rule')
      .select('*, field_def(field_name), mapping_option(*)')
      .eq('project_id', projectId)
      .eq('template_id', t.template_id)
      .order('mapping_id')
    if (data) setMappings(data as unknown as MappingRule[])
  }

  async function deleteTemplate(t: Template) {
    if (projectId == null) return
    if (!confirm(`Delete template "${t.template_code}" and all its mappings?`)) return
    await supabase.from('mapping_rule').delete().eq('template_id', t.template_id)
    await supabase.from('template').delete().eq('template_id', t.template_id)
    setSelectedTemplate(null)
    setMappings([])
    loadTemplates(projectId)
  }

  async function deleteMapping(mappingId: number) {
    if (!confirm('Delete this mapping rule?')) return
    await supabase.from('mapping_rule').delete().eq('mapping_id', mappingId)
    if (selectedTemplate) selectTemplate(selectedTemplate)
  }

  function startEditName(t: Template) {
    setEditingNameId(t.template_id)
    setEditingNameValue(t.template_name ?? '')
  }

  async function saveEditName(templateId: number) {
    if (projectId == null) return
    const newName = editingNameValue.trim() || null
    await supabase.from('template').update({ template_name: newName }).eq('template_id', templateId)
    setEditingNameId(null)
    loadTemplates(projectId)
  }

  if (loading) {
    return <div className="text-gray-500">Loading templates...</div>
  }

  if (projectId == null) {
    return <div className="text-gray-500">프로젝트가 선택되지 않았습니다.</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Form Management</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template list */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-2">
            Templates ({templates.length})
          </h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {templates.map((t) => (
              <div
                key={t.template_id}
                className={`px-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                  selectedTemplate?.template_id === t.template_id ? 'bg-blue-50' : ''
                }`}
                onClick={() => selectTemplate(t)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t.template_code}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditName(t) }}
                      className="text-blue-400 hover:text-blue-600 text-xs px-1"
                      title="Edit name"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTemplate(t) }}
                      className="text-red-400 hover:text-red-600 text-xs px-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {editingNameId === t.template_id ? (
                  <div className="flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={editingNameValue}
                      onChange={e => setEditingNameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEditName(t.template_id); if (e.key === 'Escape') setEditingNameId(null) }}
                      className="flex-1 px-2 py-0.5 text-xs border border-blue-300 rounded focus:outline-none"
                      placeholder="Template name..."
                    />
                    <button onClick={() => saveEditName(t.template_id)} className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                    <button onClick={() => setEditingNameId(null)} className="text-xs px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100">✕</button>
                  </div>
                ) : (
                  t.template_name && (
                    <div className="text-xs text-gray-500 mt-0.5">{t.template_name}</div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mapping details */}
        <div className="lg:col-span-2">
          {selectedTemplate ? (
            <div>
              <h2 className="text-sm font-semibold text-gray-600 mb-2">
                Mappings for {selectedTemplate.template_code} ({mappings.length})
              </h2>
              <div className="bg-white rounded-lg shadow overflow-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Field</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Sheet</th>
                      <th className="px-3 py-2 text-left">Cell</th>
                      <th className="px-3 py-2 text-left">Remark</th>
                      <th className="px-3 py-2 text-left">Options</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {mappings.map((m) => {
                      const expanded = m as MappingRule & {
                        field_def?: { field_name: string } | null
                        mapping_option?: { expected_value: string | null }[]
                      }
                      return (
                        <tr key={m.mapping_id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{expanded.field_def?.field_name ?? m.field_id}</td>
                          <td className="px-3 py-2">{m.data_type}</td>
                          <td className="px-3 py-2">{m.target_sheet}</td>
                          <td className="px-3 py-2">{m.target_cell}</td>
                          <td className="px-3 py-2 text-gray-500">{m.remark}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs">
                            {expanded.mapping_option?.map(o => o.expected_value).filter(Boolean).join(', ')}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => deleteMapping(m.mapping_id)}
                              className="text-red-400 hover:text-red-600 text-xs"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 py-8 text-center">
              Select a template to view its mappings
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
