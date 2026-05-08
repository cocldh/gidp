'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import ExcelJS from 'exceljs'
import * as SheetJS from 'xlsx'
import dynamic from 'next/dynamic'
import type { GridApi } from 'ag-grid-community'
import type { ColDef } from 'ag-grid-community'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole } from './RoleGuard'
import type { BrowserRow, FieldColumn, Template } from '@/lib/types'

const BrowserGrid = dynamic(() => import('./BrowserGrid'), { ssr: false })

type BrowserMode = 'total' | 'form'
type EditKey = string

const makeKey = (docId: number, fieldName: string): EditKey => `${docId}__${fieldName}`

const NON_EDITABLE_FIELDS = new Set([
  '_doc_id', '_tag_id', '_select', '_minor_revision', '_revision_number',
  'tag_number', 'document_number', 'template_code', 'sheet_number', 'revision',
])

function nextMinorRevision(current: string | null): string {
  if (!current) return 'a'
  const chars = current.split('')
  let i = chars.length - 1
  while (i >= 0) {
    if (chars[i] < 'z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1)
      return chars.join('')
    }
    chars[i] = 'a'
    i--
  }
  return 'a'.repeat(chars.length + 1)
}

export default function BrowserTable() {
  const supabase = createClient()
  const iss = supabase.schema('iss')
  const { hasRole } = useUserRole()
  const canEdit = hasRole('Editor')
  const isAdmin = hasRole('Admin')

  const [projectId, setProjectId] = useState<number | null>(null)
  const [browserMode, setBrowserMode] = useState<BrowserMode>('form')
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')

  const [rowData, setRowData] = useState<Record<string, unknown>[]>([])
  const [columnDefs, setColumnDefs] = useState<ColDef[]>([])
  const [totalHint, setTotalHint] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]

  const pendingEdits = useRef<Map<EditKey, string | null>>(new Map())
  const originalValues = useRef<Map<EditKey, string | null>>(new Map())
  const [pendingCount, setPendingCount] = useState(0)
  const loadIdRef = useRef(0)

  const changedSetRef = useRef<Set<string>>(new Set())

  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())

  const gridApiRef = useRef<GridApi | null>(null)

  // ── 데이터 로드 ───────────────────────────────────────────────────────────

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

  const buildFixedCols = (): ColDef[] => [
    {
      field: '_select',
      headerName: '',
      width: 40, minWidth: 40, maxWidth: 40,
      pinned: 'left' as const,
      editable: false, sortable: false, filter: false, resizable: false,
      cellRenderer: (params: any) => {
        const docId = params.data?._doc_id
        if (!docId) return null
        return (
          <input
            type="checkbox"
            checked={selectedDocIds.has(docId)}
            onChange={() => toggleDoc(docId)}
            className="accent-indigo-600"
            onClick={e => e.stopPropagation()}
          />
        )
      },
      headerComponent: () => (
        <input type="checkbox" className="accent-indigo-600" onChange={toggleAllDocs} onClick={e => e.stopPropagation()} />
      ),
    },
    { field: 'tag_number', headerName: 'Tag Number', pinned: 'left' as const, editable: false, width: 140, minWidth: 100 },
    { field: 'document_number', headerName: 'Document', pinned: 'left' as const, editable: false, width: 160, minWidth: 120 },
    { field: 'template_code', headerName: 'Template', editable: false, width: 120, minWidth: 80 },
    { field: 'sheet_number', headerName: 'Sheet', editable: false, width: 70, minWidth: 60 },
    { field: 'revision', headerName: 'Rev', editable: false, width: 70, minWidth: 50 },
  ]

  const captureOriginals = (rows: BrowserRow[]) => {
    for (const row of rows) {
      for (const [fieldName, value] of Object.entries(row.field_values)) {
        originalValues.current.set(makeKey(row.document_id, fieldName), value ?? null)
      }
    }
  }

  const flattenRows = (rows: BrowserRow[]) => rows.map(row => ({
    _doc_id: row.document_id,
    _tag_id: row.tag_id,
    _minor_revision: row.minor_revision,
    _revision_number: row.revision_number,
    tag_number: row.tag_number,
    document_number: row.document_number,
    template_code: row.template_code,
    sheet_number: row.sheet_number ?? '',
    revision: (row.revision_number ?? '') + (row.minor_revision ?? ''),
    ...row.field_values,
  }))

  const fetchChangedCells = async (docIds: number[], fieldCols: FieldColumn[]) => {
    if (docIds.length === 0) return new Set<string>()
    const { data } = await iss
      .from('document_value_change')
      .select('document_id, field_id')
      .in('document_id', docIds)
    const fieldIdToName = new Map(fieldCols.map(c => [c.field_id, c.field_name]))
    return new Set(
      ((data ?? []) as Array<{ document_id: number; field_id: number }>)
        .map(d => makeKey(d.document_id, fieldIdToName.get(d.field_id) ?? String(d.field_id)))
    )
  }

  const buildDynCols = (fieldCols: FieldColumn[], customOrder: string[]): ColDef[] => {
    const orderMap = new Map(customOrder.map((name, idx) => [name, idx]))
    const enriched = [...fieldCols]
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
    return enriched.map(col => ({
      field: col.field_name,
      headerName: col.field_name,
      editable: canEdit,
      width: 150, minWidth: 80,
      cellEditor: col.field_name.toLowerCase().includes('note') ? 'agLargeTextCellEditor' : 'agTextCellEditor',
      cellEditorPopup: col.field_name.toLowerCase().includes('note'),
    }))
  }

  const STREAM_CHUNK = 1000

  const loadData = useCallback(async (p = 0) => {
    if (projectId == null) return
    if (browserMode === 'form' && !selectedTemplate) return

    const loadId = ++loadIdRef.current
    setLoading(true)
    setPage(p)
    setIsStreaming(false)
    setTotalCount(0)
    pendingEdits.current.clear()
    originalValues.current.clear()
    setPendingCount(0)

    const templateCode = selectedTemplate
      ? templates.find(t => t.template_id === selectedTemplate)?.template_code ?? null
      : null

    // ── 컬럼 정의 로드 ─────────────────────────────────────────────────────
    const [colRes, customOrderRes] = await Promise.all([
      supabase.rpc('iss_get_field_columns', {
        p_project_id: projectId,
        p_template_id: selectedTemplate,
      }),
      templateCode
        ? fetch(`/iss/api/column-order?form=${encodeURIComponent(templateCode)}&project_id=${projectId}`)
            .then(r => r.json()).then(j => j.order ?? []).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ])

    if (loadId !== loadIdRef.current) return

    let fieldCols: FieldColumn[] = []
    if (colRes.data) {
      const typedCols = colRes.data as FieldColumn[]
      const fieldIds = typedCols.map(c => c.field_id)
      const { data: kindData } = await iss
        .from('field_def')
        .select('field_id, data_kind')
        .in('field_id', fieldIds)
      const kindMap: Record<number, string> = {}
      for (const k of (kindData ?? []) as Array<{ field_id: number; data_kind: string | null }>) {
        kindMap[k.field_id] = k.data_kind ?? ''
      }
      fieldCols = typedCols.map(c => ({ ...c, data_kind: kindMap[c.field_id] ?? '' }))
    }

    if (loadId !== loadIdRef.current) return

    // ── Total Browser: 첫 1000행 즉시 표시 후 백그라운드 스트리밍 ──────────
    if (browserMode === 'total') {
      const { data: firstData } = await supabase.rpc('iss_get_browser_data', {
        p_project_id: projectId,
        p_template_id: null,
        p_search: search.trim() || null,
        p_limit: STREAM_CHUNK,
        p_offset: 0,
      })

      if (loadId !== loadIdRef.current) return

      const firstData_ = (firstData ?? []) as BrowserRow[]
      captureOriginals(firstData_)
      const firstRows = flattenRows(firstData_)
      const changedFirst = await fetchChangedCells(firstRows.map(r => r._doc_id as number), fieldCols)
      if (loadId !== loadIdRef.current) return

      changedSetRef.current = changedFirst
      setColumnDefs([...buildFixedCols(), ...buildDynCols(fieldCols, customOrderRes)])
      setRowData(firstRows)
      setTotalHint(String(firstRows.length))
      setHasSearched(true)
      setLoading(false)
      setSelectedDocIds(new Set())

      // Phase 2: 백그라운드 스트리밍
      if (firstRows.length === STREAM_CHUNK) {
        setIsStreaming(true)
        let offset = STREAM_CHUNK
        while (true) {
          const { data: chunk } = await supabase.rpc('iss_get_browser_data', {
            p_project_id: projectId,
            p_template_id: null,
            p_search: search.trim() || null,
            p_limit: STREAM_CHUNK,
            p_offset: offset,
          })
          if (loadId !== loadIdRef.current) return

          const moreRows = (chunk ?? []) as BrowserRow[]
          if (moreRows.length === 0) break

          captureOriginals(moreRows)
          const flat = flattenRows(moreRows)
          const changedChunk = await fetchChangedCells(flat.map(r => r._doc_id as number), fieldCols)
          if (loadId !== loadIdRef.current) return

          for (const k of changedChunk) changedSetRef.current.add(k)
          gridApiRef.current?.applyTransaction({ add: flat })
          setTotalHint(prev => String(parseInt(prev) + flat.length))

          offset += STREAM_CHUNK
          if (moreRows.length < STREAM_CHUNK) break
        }
        setIsStreaming(false)
      }
      return
    }

    // ── Form Browser: 기존 페이지네이션 방식 ─────────────────────────────
    const { data: rowDataRaw } = await supabase.rpc('iss_get_browser_data', {
      p_project_id: projectId,
      p_template_id: selectedTemplate,
      p_search: search.trim() || null,
      p_limit: pageSize + 1,
      p_offset: p * pageSize,
    })

    if (loadId !== loadIdRef.current) return

    if (rowDataRaw) {
      const typed = rowDataRaw as BrowserRow[]
      const hasMore = typed.length > pageSize
      const displayRows = hasMore ? typed.slice(0, pageSize) : typed
      setTotalHint(hasMore ? `${pageSize}+` : `${typed.length}`)

      const changedCells = await fetchChangedCells(displayRows.map(r => r.document_id), fieldCols)
      if (loadId !== loadIdRef.current) return
      changedSetRef.current = changedCells

      captureOriginals(displayRows)
      setRowData(flattenRows(displayRows))
      setColumnDefs([...buildFixedCols(), ...buildDynCols(fieldCols, customOrderRes)])
    } else {
      setRowData([])
      setTotalHint('0')
      changedSetRef.current = new Set()
      setColumnDefs([])
    }

    setHasSearched(true)
    setLoading(false)
    setSelectedDocIds(new Set())
  }, [projectId, selectedTemplate, search, pageSize, browserMode, templates, canEdit])

  // ── 편집 저장 ─────────────────────────────────────────────────────────────

  const onCellValueChanged = useCallback((event: any) => {
    const { data, colDef, oldValue, newValue } = event
    const fieldName = colDef.field as string
    if (NON_EDITABLE_FIELDS.has(fieldName)) return
    if (oldValue === newValue) return
    const docId = data._doc_id as number
    const key = makeKey(docId, fieldName)
    const normalizedNew = newValue === '' ? null : (newValue as string | null)
    const original = originalValues.current.get(key) ?? null
    if (normalizedNew === original) {
      pendingEdits.current.delete(key)
    } else {
      pendingEdits.current.set(key, normalizedNew)
    }
    setPendingCount(pendingEdits.current.size)
  }, [])

  const handleSave = async () => {
    if (pendingEdits.current.size === 0) return
    setSaving(true)
    setMessage('')

    // field_name → field_id 매핑
    const fieldNames = Array.from(new Set(
      Array.from(pendingEdits.current.keys()).map(k => k.split('__')[1])
    ))
    const { data: fieldRows } = await iss
      .from('field_def')
      .select('field_id, field_name')
      .in('field_name', fieldNames)
    const nameToId = new Map((fieldRows ?? []).map((r: any) => [r.field_name, r.field_id]))

    // document별 변경사항 그룹핑
    const byDoc = new Map<number, Array<{ fieldName: string; fieldId: number; newValue: string | null }>>()
    for (const [key, value] of pendingEdits.current.entries()) {
      const [docIdStr, fieldName] = key.split('__')
      const fieldId = nameToId.get(fieldName)
      if (!fieldId) continue
      const docId = parseInt(docIdStr)
      if (!byDoc.has(docId)) byDoc.set(docId, [])
      byDoc.get(docId)!.push({ fieldName, fieldId, newValue: value })
    }

    const docIds = Array.from(byDoc.keys())

    // 저장 전 이전 값 스냅샷 (변경 감지용)
    const { data: prevValRows } = await iss
      .from('document_value')
      .select('document_id, field_id, value_text')
      .in('document_id', docIds)
    const prevMap = new Map<string, string | null>()
    for (const pv of (prevValRows ?? []) as Array<{ document_id: number; field_id: number; value_text: string | null }>) {
      prevMap.set(`${pv.document_id}__${pv.field_id}`, pv.value_text ?? null)
    }

    // document_value upsert
    const upserts = Array.from(byDoc.entries()).flatMap(([docId, changes]) =>
      changes.map(c => ({ document_id: docId, field_id: c.fieldId, value_text: c.newValue }))
    )
    const { error } = await iss
      .from('document_value')
      .upsert(upserts, { onConflict: 'document_id,field_id' })

    if (error) {
      setMessage(`Error: ${error.message}`)
      setSaving(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    const committedBy = user?.email ?? null

    // 각 document별 revision 처리
    for (const [docId, changes] of byDoc.entries()) {
      const actualChanges = changes
        .map(c => ({
          ...c,
          previousValue: prevMap.get(`${docId}__${c.fieldId}`) ?? null,
        }))
        .filter(c => c.previousValue !== c.newValue)

      if (actualChanges.length === 0) continue

      const rowNode = rowData.find(r => (r as any)._doc_id === docId) as any
      const currentMinorRevision = (rowNode?._minor_revision as string | null) ?? null
      const currentRevNumber = (rowNode?._revision_number as string | null) ?? null
      const tagNumber = (rowNode?.tag_number as string | null) ?? null
      const documentNumber = (rowNode?.document_number as string | null) ?? null

      const newMinor = nextMinorRevision(currentMinorRevision)
      const displayRev = (currentRevNumber ?? '') + newMinor

      await iss.from('document').update({ minor_revision: newMinor }).eq('document_id', docId)

      const { data: revData } = await iss
        .from('document_revision')
        .insert({
          document_id: docId,
          revision_number: displayRev,
          revision_type: 'minor',
          note: null,
          committed_by: committedBy,
        })
        .select('revision_id, committed_at')
        .single()

      const revisionId = (revData as any)?.revision_id as number | null
      const revCommittedAt = (revData as any)?.committed_at as string | null ?? new Date().toISOString()

      if (revisionId) {
        const details = actualChanges.map(c => ({
          revision_id: revisionId,
          document_number: documentNumber ?? '',
          tag_number: tagNumber,
          field_name: c.fieldName,
          previous_value: c.previousValue,
          new_value: c.newValue,
          changed_at: revCommittedAt,
          changed_by: committedBy,
        }))
        await iss.from('document_revision_detail').insert(details)
      }

      if (!currentMinorRevision) {
        let allSheetQuery = iss
          .from('document')
          .select('document_id')
          .eq('document_number', documentNumber ?? '')
        if (projectId != null) allSheetQuery = allSheetQuery.eq('project_id', projectId)
        const { data: allSheetDocs } = await allSheetQuery
        const allSheetIds = (allSheetDocs ?? []).map((d: any) => d.document_id as number)
        if (allSheetIds.length > 0) {
          await iss.from('document_value_change').delete().in('document_id', allSheetIds)
        }
        const dvcInserts = actualChanges.map(c => ({
          document_id: docId,
          field_id: c.fieldId,
          field_name: c.fieldName,
          previous_value: c.previousValue,
          new_value: c.newValue,
          tag_number: tagNumber,
          changed_at: revCommittedAt,
          changed_by: committedBy,
        }))
        if (dvcInserts.length > 0) {
          await iss.from('document_value_change').upsert(dvcInserts, { onConflict: 'document_id,field_id' })
        }
      } else {
        const { data: existingDvc } = await iss
          .from('document_value_change')
          .select('field_id, previous_value, new_value')
          .eq('document_id', docId)
        const existingDvcMap = new Map((existingDvc ?? []).map((e: any) => [e.field_id as number, e]))

        const dvcUpserts = actualChanges.map(c => {
          const existing = existingDvcMap.get(c.fieldId)
          return {
            document_id: docId,
            field_id: c.fieldId,
            field_name: c.fieldName,
            previous_value: existing ? existing.previous_value : c.previousValue,
            new_value: c.newValue,
            tag_number: tagNumber,
            changed_at: revCommittedAt,
            changed_by: committedBy,
          }
        })

        const revertedFieldIds = dvcUpserts
          .filter(d => d.previous_value === d.new_value)
          .map(d => d.field_id)
        const toUpsert = dvcUpserts.filter(d => d.previous_value !== d.new_value)

        for (const fid of revertedFieldIds) {
          await iss.from('document_value_change').delete().eq('document_id', docId).eq('field_id', fid)
        }
        if (toUpsert.length > 0) {
          await iss.from('document_value_change').upsert(toUpsert, { onConflict: 'document_id,field_id' })
        }
      }
    }

    setMessage(`Saved ${upserts.length} cell(s) — Minor Revision 자동 커밋`)
    pendingEdits.current.clear()
    setPendingCount(0)
    gridApiRef.current?.refreshCells({ force: true })
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  // ── 체크박스 선택 ─────────────────────────────────────────────────────────

  const toggleDoc = useCallback((docId: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }, [])

  const toggleAllDocs = useCallback(() => {
    const api = gridApiRef.current
    if (!api) return
    const allIds: number[] = []
    api.forEachNodeAfterFilter(node => { if (node.data?._doc_id) allIds.push(node.data._doc_id) })
    setSelectedDocIds(prev => prev.size === allIds.length ? new Set() : new Set(allIds))
  }, [])

  // ── PDF 생성 ──────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    const ids = Array.from(selectedDocIds)
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
      setSelectedDocIds(new Set())
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setGenerating(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  // ── 내보내기 ──────────────────────────────────────────────────────────────

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  const visibleColumnKeys = () =>
    columnDefs
      .filter(c => c.field && !c.field.startsWith('_'))
      .map(c => c.field as string)

  const exportCSV = () => {
    gridApiRef.current?.exportDataAsCsv({
      fileName: `iss_browser_${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: visibleColumnKeys(),
    })
    setExportOpen(false)
  }

  const exportXlsx = async () => {
    const api = gridApiRef.current
    if (!api) return
    setExportOpen(false)

    const keys = visibleColumnKeys()
    const headers = keys.map(k => columnDefs.find(c => c.field === k)?.headerName ?? k)

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('ISS Browser')

    ws.addRow(headers)
    ws.getRow(1).height = 30
    ws.getRow(1).eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6B8E' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })

    const maxLen = headers.map(h => h.length)
    api.forEachNodeAfterFilterAndSort(node => {
      const docId = node.data?._doc_id as number | undefined
      const vals = keys.map((k, i) => {
        const v = node.data?.[k]
        const s = (v == null || v === '') ? null : String(v)
        if (s != null && s.length > maxLen[i]) maxLen[i] = s.length
        return s
      })
      const row = ws.addRow(vals)
      keys.forEach((k, i) => {
        const editKey = docId != null ? makeKey(docId, k) : null
        const isPending = editKey != null && pendingEdits.current.has(editKey)
        const isChanged = editKey != null && changedSetRef.current.has(editKey)
        if (vals[i] != null || isPending || isChanged) {
          const cell = row.getCell(i + 1)
          cell.font = { name: 'Calibri', size: 11 }
          if (isPending) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }
          } else if (isChanged) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFCE8' } }
          }
        }
      })
    })

    keys.forEach((_, i) => { ws.getColumn(i + 1).width = Math.min(maxLen[i] + 2, 50) })

    const buf = await wb.xlsx.writeBuffer()
    triggerDownload(buf, `iss_browser_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const exportXlsb = () => {
    const api = gridApiRef.current
    if (!api) return
    setExportOpen(false)

    const keys = visibleColumnKeys()
    const headers = keys.map(k => columnDefs.find(c => c.field === k)?.headerName ?? k)

    const rows: string[][] = [headers]
    const maxLen = headers.map(h => h.length)
    api.forEachNodeAfterFilterAndSort(node => {
      rows.push(keys.map((k, i) => {
        const s = node.data?.[k] == null ? '' : String(node.data[k])
        if (s.length > maxLen[i]) maxLen[i] = s.length
        return s
      }))
    })

    const ws = SheetJS.utils.aoa_to_sheet(rows)
    ws['!cols'] = maxLen.map(w => ({ wch: Math.min(w + 2, 50) }))
    const wb = SheetJS.utils.book_new()
    SheetJS.utils.book_append_sheet(wb, ws, 'ISS Browser')
    SheetJS.writeFile(wb, `iss_browser_${new Date().toISOString().slice(0, 10)}.xlsb`, { bookType: 'xlsb' })
  }

  const triggerDownload = (buf: ArrayBuffer | ArrayBufferLike, filename: string) => {
    const blob = new Blob([new Uint8Array(buf as ArrayBuffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  // ── 모드/템플릿 변경 ──────────────────────────────────────────────────────

  const resetGrid = () => {
    setHasSearched(false)
    setRowData([])
    setColumnDefs([])
    pendingEdits.current.clear()
    setPendingCount(0)
  }

  const handleTemplateChange = (val: string) => {
    setSelectedTemplate(val ? parseInt(val) : null)
    resetGrid()
  }

  const handleModeChange = (mode: BrowserMode) => {
    setBrowserMode(mode)
    resetGrid()
  }

  if (projectId == null) {
    return <div className="text-center text-gray-500 py-8">프로젝트가 선택되지 않았습니다.</div>
  }

  const showGrid = !loading && hasSearched && rowData.length > 0

  return (
    <div className="flex flex-col">
      {/* 탭 */}
      <div className="flex border-b border-gray-200 mb-3">
        {isAdmin && (
          <button
            onClick={() => handleModeChange('total')}
            className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              browserMode === 'total' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Total Browser
          </button>
        )}
        <button
          onClick={() => handleModeChange('form')}
          className={`px-5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            browserMode === 'form' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Form Browser
        </button>
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={selectedTemplate ?? ''}
          onChange={e => handleTemplateChange(e.target.value)}
          className={`px-3 py-2 border rounded text-sm ${browserMode === 'form' && !selectedTemplate ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white'}`}
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
          onKeyDown={e => { if (e.key === 'Enter') loadData(0) }}
          className="px-3 py-2 border border-gray-300 rounded text-sm flex-1 min-w-48 bg-white"
        />

        {browserMode === 'form' && (
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setHasSearched(false) }}
            className="px-3 py-2 border border-gray-300 rounded text-sm bg-white"
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} rows</option>)}
          </select>
        )}

        <button
          onClick={() => loadData(0)}
          disabled={browserMode === 'form' && !selectedTemplate}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          Search
        </button>

        <button
          onClick={() => gridApiRef.current?.setFilterModel(null)}
          disabled={!showGrid}
          className="px-4 py-2 border border-gray-300 rounded text-sm hover:border-red-400 hover:text-red-500 disabled:opacity-40"
        >
          Clear Filters
        </button>

        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(v => !v)}
            disabled={!showGrid || isStreaming}
            title={isStreaming ? '데이터 로딩 중 — 완료 후 내보내기 가능' : undefined}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm flex items-center gap-1"
          >
            Export
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {exportOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-50" style={{ minWidth: '100%' }}>
              <button onClick={exportCSV} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">CSV</button>
              <button onClick={exportXlsx} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">XLSX</button>
              <button onClick={exportXlsb} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">XLSB</button>
            </div>
          )}
        </div>

        {canEdit && selectedDocIds.size > 0 && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            {generating ? 'Generating...' : `Generate (${selectedDocIds.size})`}
          </button>
        )}

        {canEdit && pendingCount > 0 && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? 'Saving...' : `Save Changes (${pendingCount})`}
          </button>
        )}

        {message && (
          <span className={`text-sm self-center ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </span>
        )}
      </div>

      {/* 행 수 / 스트리밍 상태 */}
      {hasSearched && (
        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
          {browserMode === 'total' ? (
            <span className="flex items-center gap-2">
              {isStreaming ? (
                <>
                  <svg className="animate-spin w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {parseInt(totalHint).toLocaleString()} rows (loading…)
                </>
              ) : (
                <>{parseInt(totalHint).toLocaleString()} rows</>
              )}
            </span>
          ) : (
            <>
              <span>
                Page {page + 1} · {rowData.length} rows
                {totalHint.endsWith('+') && ' (more available)'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => loadData(page - 1)} disabled={page === 0 || loading}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30">Prev</button>
                <button onClick={() => loadData(page + 1)} disabled={!totalHint.endsWith('+') || loading}
                  className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-30">Next</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 상태 메시지 */}
      {!showGrid && (
        <div className="text-center text-gray-500 py-8">
          {loading
            ? 'Loading...'
            : !hasSearched
              ? browserMode === 'form' && !selectedTemplate
                ? 'Form Browser requires a template selection'
                : 'Select a template or enter a search term and click Search'
              : 'No data found'}
        </div>
      )}

      {/* 그리드 — 데이터가 준비됐을 때만 마운트 (Strict Mode 이중 실행 회피) */}
      {showGrid && (
        <BrowserGrid
          rowData={rowData}
          columnDefs={columnDefs}
          canEdit={canEdit}
          changedSetRef={changedSetRef}
          pendingEditsRef={pendingEdits}
          onGridReady={api => { gridApiRef.current = api }}
          onCellValueChanged={onCellValueChanged}
        />
      )}
    </div>
  )
}
