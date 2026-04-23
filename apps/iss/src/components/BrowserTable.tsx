'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole } from './RoleGuard'
import type { BrowserRow, FieldColumn, Template } from '@/lib/types'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]

type EditKey = string
type BrowserMode = 'total' | 'form'
const makeKey = (docId: number, fieldId: number): EditKey => `${docId}_${fieldId}`

export default function BrowserTable() {
  const supabase = createClient()
  const iss = supabase.schema('iss')
  const { hasRole } = useUserRole()
  const canEdit = hasRole('Editor')
  const isAdmin = hasRole('Admin')

  const [projectId, setProjectId] = useState<number | null>(null)
  const [browserMode, setBrowserMode] = useState<BrowserMode>('form')
  const [rows, setRows] = useState<BrowserRow[]>([])
  const [columns, setColumns] = useState<FieldColumn[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(0)
  const [totalHint, setTotalHint] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [editedCells, setEditedCells] = useState<Record<EditKey, string>>({})
  const [changedSet, setChangedSet] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    const pid = readProjectIdCookie()
    setProjectId(pid)
  }, [])

  useEffect(() => {
    if (projectId != null) loadTemplates(projectId)
  }, [projectId])

  async function loadTemplates(pid: number) {
    const { data } = await iss
      .from('template')
      .select('template_id, template_code, template_name')
      .eq('project_id', pid)
      .order('template_code')
    if (data) setTemplates(data as Template[])
  }

  const loadData = useCallback(async (p = 0) => {
    if (projectId == null) return
    if (browserMode === 'form' && !selectedTemplate) return
    setLoading(true)
    setPage(p)
    setColumnFilters({})

    const templateCode = selectedTemplate
      ? templates.find(t => t.template_id === selectedTemplate)?.template_code ?? null
      : null

    const [{ data: colData }, { data: rowData }] = await Promise.all([
      supabase.rpc('iss_get_field_columns', {
        p_project_id: projectId,
        p_template_id: selectedTemplate,
      }),
      supabase.rpc('iss_get_browser_data', {
        p_project_id: projectId,
        p_template_id: selectedTemplate,
        p_search: search.trim() || null,
        p_limit: pageSize + 1,
        p_offset: p * pageSize,
      }),
    ])

    let customOrder: string[] = []
    if (templateCode) {
      try {
        const res = await fetch(
          `/api/column-order?form=${encodeURIComponent(templateCode)}&project_id=${projectId}`,
        )
        const json = await res.json()
        customOrder = json.order ?? []
      } catch {}
    }

    if (colData) {
      const typedCols = colData as FieldColumn[]
      const fieldIds = typedCols.map(c => c.field_id)
      const { data: kindData } = await iss
        .from('field_def')
        .select('field_id, data_kind')
        .in('field_id', fieldIds)
      const kindMap: Record<number, string> = {}
      for (const k of (kindData ?? []) as Array<{ field_id: number; data_kind: string | null }>) {
        kindMap[k.field_id] = k.data_kind ?? ''
      }
      const enriched = typedCols.map(c => ({ ...c, data_kind: kindMap[c.field_id] ?? '' }))
      const orderMap = new Map(customOrder.map((name, idx) => [name, idx]))
      enriched.sort((a, b) => {
        const g = (c: FieldColumn) => c.data_kind === 'default' ? 0 : c.field_name.toLowerCase().includes('note') ? 2 : 1
        const ga = g(a), gb = g(b)
        if (ga !== gb) return ga - gb
        if (ga === 1 && orderMap.size > 0) {
          const ia = orderMap.has(a.field_name) ? orderMap.get(a.field_name)! : 9999
          const ib = orderMap.has(b.field_name) ? orderMap.get(b.field_name)! : 9999
          return ia - ib
        }
        return 0
      })
      setColumns(enriched)
    }

    if (rowData) {
      const typed = rowData as BrowserRow[]
      const hasMore = typed.length > pageSize
      const displayRows = hasMore ? typed.slice(0, pageSize) : typed
      setRows(displayRows)
      setTotalHint(hasMore ? `${pageSize}+` : `${typed.length}`)

      const docIds = displayRows.map(r => r.document_id)
      if (docIds.length > 0) {
        const { data: changedData } = await iss
          .from('document_value_change')
          .select('document_id, field_id')
          .in('document_id', docIds)
        setChangedSet(
          new Set(
            ((changedData ?? []) as Array<{ document_id: number; field_id: number }>).map(
              d => `${d.document_id}_${d.field_id}`,
            ),
          ),
        )
      } else {
        setChangedSet(new Set())
      }
    } else {
      setRows([])
      setTotalHint('0')
      setChangedSet(new Set())
    }

    setHasSearched(true)
    setLoading(false)
  }, [projectId, selectedTemplate, search, pageSize, browserMode, templates])

  const filteredRows = rows.filter(row => {
    for (const [key, val] of Object.entries(columnFilters)) {
      if (!val.trim()) continue
      const lower = val.toLowerCase()
      let cellVal = ''
      if (key === 'tag_number') cellVal = row.tag_number ?? ''
      else if (key === 'document_number') cellVal = row.document_number ?? ''
      else if (key === 'template_code') cellVal = row.template_code ?? ''
      else if (key === 'sheet_number') cellVal = String(row.sheet_number ?? '')
      else if (key === 'revision_number') cellVal = (row.revision_number ?? '') + (row.minor_revision ?? '')
      else cellVal = row.field_values[key] ?? ''
      if (!cellVal.toLowerCase().includes(lower)) return false
    }
    return true
  })

  const hasActiveFilters = Object.values(columnFilters).some(v => v.trim())
  const setColFilter = (key: string, val: string) => setColumnFilters(prev => ({ ...prev, [key]: val }))

  const handleSearch = () => loadData(0)
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch() }

  const handleTemplateChange = (val: string) => {
    setSelectedTemplate(val ? parseInt(val) : null)
    setHasSearched(false)
    setRows([])
    setColumns([])
    setEditedCells({})
    setColumnFilters({})
  }

  const handleModeChange = (mode: BrowserMode) => {
    setBrowserMode(mode)
    setHasSearched(false)
    setRows([])
    setColumns([])
    setColumnFilters({})
  }

  const handleCellChange = (docId: number, fieldId: number, value: string) => {
    setEditedCells(prev => ({ ...prev, [makeKey(docId, fieldId)]: value }))
  }

  const handleSave = async () => {
    const entries = Object.entries(editedCells)
    if (entries.length === 0) return
    setSaving(true)
    setMessage('')
    const upserts = entries.map(([key, value]) => {
      const [docId, fieldId] = key.split('_').map(Number)
      return { document_id: docId, field_id: fieldId, value_text: value || null }
    })
    const { error } = await iss
      .from('document_value')
      .upsert(upserts, { onConflict: 'document_id,field_id' })
    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage(`Saved ${upserts.length} cell(s)`)
      setEditedCells({})
      await loadData(page)
    }
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const hasChanges = Object.keys(editedCells).length > 0

  const toggleDoc = (docId: number) => {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const toggleAllDocs = () => {
    if (selectedDocs.size === filteredRows.length) setSelectedDocs(new Set())
    else setSelectedDocs(new Set(filteredRows.map(r => r.document_id)))
  }

  async function handleGenerate() {
    const ids = Array.from(selectedDocs)
    if (ids.length === 0) return
    setGenerating(true)
    setMessage('')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: ids }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setMessage(`Error: ${err.error || 'Generation failed'}`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="(.+?)"/)
      const filename = match?.[1] ?? (ids.length === 1 ? 'document.xlsx' : 'ISS_Forms.zip')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setMessage(`Generated ${ids.length} document(s)`)
      setSelectedDocs(new Set())
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setGenerating(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  function exportCSV() {
    if (filteredRows.length === 0) return
    const fixedHeaders = ['Tag Number', 'Document Number', 'Template', 'Sheet', 'Rev']
    const fieldHeaders = columns.map(c => c.field_name)
    const headers = [...fixedHeaders, ...fieldHeaders]
    const csvRows = [
      headers.join(','),
      ...filteredRows.map(row => {
        const fixed = [row.tag_number, row.document_number, row.template_code, row.sheet_number ?? '', (row.revision_number ?? '') + (row.minor_revision ?? '')]
        const fieldVals = columns.map(c => row.field_values[c.field_name] ?? '')
        return [...fixed, ...fieldVals].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      }),
    ]
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `iss_browser_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filterInput = (key: string) => (
    <input
      type="text"
      value={columnFilters[key] ?? ''}
      onChange={e => setColFilter(key, e.target.value)}
      placeholder="filter..."
      className="w-full px-1 py-0.5 text-[10px] border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
    />
  )

  if (projectId == null) {
    return (
      <div className="text-center text-gray-500 py-8">
        프로젝트가 선택되지 않았습니다.
      </div>
    )
  }

  return (
    <div>
      <div className="flex border-b border-gray-200 mb-3">
        {isAdmin && (
          <button
            onClick={() => handleModeChange('total')}
            className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              browserMode === 'total'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Total Browser
          </button>
        )}
        <button
          onClick={() => handleModeChange('form')}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            browserMode === 'form'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Form Browser
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={selectedTemplate ?? ''}
          onChange={e => handleTemplateChange(e.target.value)}
          className={`px-3 py-2 border rounded text-sm ${browserMode === 'form' && !selectedTemplate ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
        >
          <option value="">{browserMode === 'form' ? '— Select Template —' : 'All Templates'}</option>
          {templates.map(t => (
            <option key={t.template_id} value={t.template_id}>
              {t.template_name ? `${t.template_code} - ${t.template_name}` : t.template_code}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search tag number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="px-3 py-2 border border-gray-300 rounded text-sm flex-1 min-w-48"
          style={{ backgroundColor: '#ffffff' }}
        />
        <select
          value={pageSize}
          onChange={e => { setPageSize(parseInt(e.target.value)); setHasSearched(false) }}
          className="px-3 py-2 border border-gray-300 rounded text-sm"
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} rows</option>)}
        </select>
        <button
          onClick={handleSearch}
          disabled={browserMode === 'form' && !selectedTemplate}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
        >Search</button>
        <button
          onClick={exportCSV}
          disabled={filteredRows.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm"
        >Export CSV</button>
        {canEdit && selectedDocs.size > 0 && (
          <button onClick={handleGenerate} disabled={generating}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 text-sm">
            {generating ? 'Generating...' : `Generate (${selectedDocs.size})`}
          </button>
        )}
        {canEdit && hasChanges && (
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50 text-sm font-medium">
            {saving ? 'Saving...' : `Save Changes (${Object.keys(editedCells).length})`}
          </button>
        )}
        {hasActiveFilters && (
          <button onClick={() => setColumnFilters({})}
            className="px-3 py-2 bg-yellow-50 border border-yellow-300 text-yellow-700 rounded text-sm hover:bg-yellow-100">
            Clear Filters
          </button>
        )}
        {message && (
          <span className={`text-sm self-center ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{message}</span>
        )}
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : !hasSearched ? (
        <div className="text-center text-gray-500 py-8">
          {browserMode === 'form' && !selectedTemplate
            ? 'Form Browser requires a template selection'
            : 'Select a template or enter a search term and click Search'}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No data found</div>
      ) : (
        <div className="overflow-auto max-h-[70vh] border rounded-lg">
          <table ref={tableRef} className="text-xs border-collapse w-full">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                {canEdit && <th className="px-2 py-1.5 border-b text-center w-8"></th>}
                <th className="px-2 py-1.5 text-left border-b whitespace-nowrap">Tag Number</th>
                <th className="px-2 py-1.5 text-left border-b whitespace-nowrap">Document</th>
                <th className="px-2 py-1.5 text-left border-b whitespace-nowrap">Template</th>
                <th className="px-2 py-1.5 text-left border-b whitespace-nowrap">Sheet</th>
                <th className="px-2 py-1.5 text-left border-b whitespace-nowrap">Rev</th>
                {columns.map(col => (
                  <th key={col.field_id} className="px-2 py-1.5 text-left border-b whitespace-nowrap">{col.field_name}</th>
                ))}
              </tr>
              <tr className="bg-white">
                {canEdit && (
                  <td className="px-1 py-1 border-b text-center">
                    <input type="checkbox"
                      checked={filteredRows.length > 0 && selectedDocs.size === filteredRows.length}
                      onChange={toggleAllDocs}
                      className="accent-indigo-600"
                    />
                  </td>
                )}
                <td className="px-1 py-1 border-b">{filterInput('tag_number')}</td>
                <td className="px-1 py-1 border-b">{filterInput('document_number')}</td>
                <td className="px-1 py-1 border-b">{filterInput('template_code')}</td>
                <td className="px-1 py-1 border-b">{filterInput('sheet_number')}</td>
                <td className="px-1 py-1 border-b">{filterInput('revision_number')}</td>
                {columns.map(col => (
                  <td key={col.field_id} className="px-1 py-1 border-b">{filterInput(col.field_name)}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6 + columns.length + (canEdit ? 1 : 0)} className="text-center text-gray-400 py-6">
                    No rows match the current filters
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => (
                  <tr key={row.document_id} className="hover:bg-gray-50 border-b border-gray-100">
                    {canEdit && (
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox"
                          checked={selectedDocs.has(row.document_id)}
                          onChange={() => toggleDoc(row.document_id)}
                          className="accent-indigo-600"
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5 whitespace-nowrap">{row.tag_number}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{row.document_number}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{row.template_code}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{row.sheet_number}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{(row.revision_number ?? '') + (row.minor_revision ?? '')}</td>
                    {columns.map(col => {
                      const key = makeKey(row.document_id, col.field_id)
                      const original = row.field_values[col.field_name] ?? ''
                      const isEdited = key in editedCells
                      const isRevChanged = changedSet.has(key)
                      const isNote = col.field_name.toLowerCase().includes('note')
                      return (
                        <td key={col.field_id} className={`px-0.5 py-0.5 ${isRevChanged && !isEdited ? 'bg-yellow-50' : ''}`}>
                          {canEdit ? (
                            isNote ? (
                              <textarea
                                rows={3}
                                value={isEdited ? editedCells[key] : original}
                                onChange={e => handleCellChange(row.document_id, col.field_id, e.target.value)}
                                className={`w-full px-1.5 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none ${
                                  isEdited ? 'border-yellow-300 bg-yellow-100' : isRevChanged ? 'border-yellow-400 bg-yellow-50' : 'border-transparent hover:border-gray-300'
                                }`}
                              />
                            ) : (
                              <input type="text"
                                value={isEdited ? editedCells[key] : original}
                                onChange={e => handleCellChange(row.document_id, col.field_id, e.target.value)}
                                className={`w-full px-1.5 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                  isEdited ? 'border-yellow-300 bg-yellow-100' : isRevChanged ? 'border-yellow-400 bg-yellow-50' : 'border-transparent hover:border-gray-300'
                                }`}
                              />
                            )
                          ) : (
                            isNote
                              ? <span className={`px-1.5 whitespace-pre-wrap ${isRevChanged ? 'bg-yellow-50' : ''}`}>{original}</span>
                              : <span className={`px-1.5 whitespace-nowrap ${isRevChanged ? 'bg-yellow-50' : ''}`}>{original}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {hasSearched && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {page + 1} — showing {filteredRows.length} rows
            {hasActiveFilters && rows.length !== filteredRows.length && ` (filtered from ${rows.length})`}
            {totalHint.endsWith('+') && ' (more available)'}
          </span>
          <div className="flex gap-2">
            <button onClick={() => loadData(page - 1)} disabled={page === 0 || loading}
              className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30">Prev</button>
            <button onClick={() => loadData(page + 1)} disabled={!totalHint.endsWith('+') || loading}
              className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
