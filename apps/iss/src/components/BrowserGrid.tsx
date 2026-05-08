'use client'

import { useRef, useEffect, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import type { ColDef, GridApi, CellFocusedEvent } from 'ag-grid-community'
import ExcelStyleFilter from './ExcelStyleFilter'

interface BrowserGridProps {
  rowData: Record<string, unknown>[]
  columnDefs: ColDef[]
  canEdit: boolean
  changedSetRef: React.MutableRefObject<Set<string>>
  pendingEditsRef: React.MutableRefObject<Map<string, string | null>>
  onGridReady: (api: GridApi) => void
  onCellValueChanged: (event: any) => void
}

// ── 셀 다중 선택 헬퍼 ──────────────────────────────────────────────────────

interface RangeSel {
  startRow: number; endRow: number; startColIdx: number; endColIdx: number
}

const cellKey = (r: number, c: number) => `${r},${c}`

function rangeKeys(sel: RangeSel): Set<string> {
  const minRow = Math.min(sel.startRow, sel.endRow)
  const maxRow = Math.max(sel.startRow, sel.endRow)
  const minCol = Math.min(sel.startColIdx, sel.endColIdx)
  const maxCol = Math.max(sel.startColIdx, sel.endColIdx)
  const keys = new Set<string>()
  for (let r = minRow; r <= maxRow; r++)
    for (let c = minCol; c <= maxCol; c++)
      keys.add(cellKey(r, c))
  return keys
}

const NON_EDITABLE_FIELDS = new Set([
  '_doc_id', '_tag_id', '_select',
  'tag_number', 'document_number', 'template_code', 'sheet_number', 'revision',
])

export default function BrowserGrid({
  rowData,
  columnDefs,
  canEdit,
  changedSetRef,
  pendingEditsRef,
  onGridReady,
  onCellValueChanged,
}: BrowserGridProps) {
  const gridApiRef = useRef<GridApi | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  const shiftRangeRef = useRef<RangeSel | null>(null)
  const ctrlCellsRef = useRef<Set<string>>(new Set())
  const selectedCellsRef = useRef<Set<string>>(new Set())
  const anchorRef = useRef<{ row: number; col: number } | null>(null)
  const dragActiveRef = useRef(false)
  const shiftHeldRef = useRef(false)
  const mousedownOccurredRef = useRef(false)

  const isGridFocused = () => {
    const active = document.activeElement
    if (!active || !containerRef.current?.contains(active)) return false
    return active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA'
  }

  const scheduleRefresh = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      gridApiRef.current?.refreshCells({ force: true })
    })
  }

  const rebuildSelection = () => {
    const cells = new Set<string>()
    ctrlCellsRef.current.forEach(k => cells.add(k))
    if (shiftRangeRef.current) rangeKeys(shiftRangeRef.current).forEach(k => cells.add(k))
    selectedCellsRef.current = cells
  }

  const getColIdx = useCallback((colId: string) =>
    (gridApiRef.current?.getAllDisplayedColumns() ?? []).findIndex(c => c.getColId() === colId), [])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = true }
    const ku = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = false }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [])

  useEffect(() => {
    const handler = () => { dragActiveRef.current = false }
    window.addEventListener('mouseup', handler)
    return () => window.removeEventListener('mouseup', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.buttons & 1)) { dragActiveRef.current = false; return }
      if (!dragActiveRef.current || !anchorRef.current) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const cellEl = el?.closest?.('.ag-cell') as HTMLElement | null
      const rowEl = el?.closest?.('.ag-row') as HTMLElement | null
      if (!cellEl || !rowEl) return
      const colId = cellEl.getAttribute('col-id')
      const rowIdx = parseInt(rowEl.getAttribute('row-index') ?? '-1', 10)
      if (!colId || rowIdx < 0) return
      const colIdx = getColIdx(colId)
      if (colIdx < 0) return
      if (rowIdx === anchorRef.current.row && colIdx === anchorRef.current.col) return
      shiftRangeRef.current = { startRow: anchorRef.current.row, endRow: rowIdx, startColIdx: anchorRef.current.col, endColIdx: colIdx }
      rebuildSelection()
      scheduleRefresh()
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [getColIdx])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isGridFocused()) return
      const api = gridApiRef.current
      if (!api) return

      if (e.key === 'Escape') {
        ctrlCellsRef.current.clear()
        shiftRangeRef.current = null
        rebuildSelection()
        scheduleRefresh()
        return
      }

      if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const allCols = api.getAllDisplayedColumns()
        const focused = api.getFocusedCell()
        const anchor = anchorRef.current ?? (focused
          ? { row: focused.rowIndex, col: allCols.findIndex(c => c.getColId() === focused.column.getColId()) }
          : null)
        if (!anchor) return
        const cur = shiftRangeRef.current ?? { startRow: anchor.row, endRow: anchor.row, startColIdx: anchor.col, endColIdx: anchor.col }
        let { endRow, endColIdx } = cur
        if (e.key === 'ArrowDown') endRow = Math.min(endRow + 1, api.getDisplayedRowCount() - 1)
        if (e.key === 'ArrowUp') endRow = Math.max(endRow - 1, 0)
        if (e.key === 'ArrowRight') endColIdx = Math.min(endColIdx + 1, allCols.length - 1)
        if (e.key === 'ArrowLeft') endColIdx = Math.max(endColIdx - 1, 0)
        anchorRef.current = anchor
        shiftRangeRef.current = { startRow: anchor.row, endRow, startColIdx: anchor.col, endColIdx }
        rebuildSelection()
        scheduleRefresh()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isGridFocused()) return
      const api = gridApiRef.current
      if (!api) return
      e.preventDefault()
      const cells = selectedCellsRef.current
      const allCols = api.getAllDisplayedColumns()
      if (cells.size === 0) {
        const focused = api.getFocusedCell()
        if (!focused) return
        const node = api.getDisplayedRowAtIndex(focused.rowIndex)
        const field = focused.column.getColDef().field
        const v = field && node ? node.data[field] : ''
        e.clipboardData?.setData('text/plain', v == null ? '' : String(v))
        return
      }
      let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity
      cells.forEach(key => {
        const [r, c] = key.split(',').map(Number)
        minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r)
        minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c)
      })
      const lines: string[] = []
      for (let r = minRow; r <= maxRow; r++) {
        const node = api.getDisplayedRowAtIndex(r)
        const vals: string[] = []
        for (let c = minCol; c <= maxCol; c++) {
          if (cells.has(cellKey(r, c))) {
            const field = allCols[c]?.getColDef().field
            const v = field && node ? node.data[field] : ''
            vals.push(v == null ? '' : String(v))
          } else {
            vals.push('')
          }
        }
        lines.push(vals.join('\t'))
      }
      e.clipboardData?.setData('text/plain', lines.join('\n'))
    }
    window.addEventListener('copy', handler)
    return () => window.removeEventListener('copy', handler)
  }, [])

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isGridFocused() || !canEdit) return
      const api = gridApiRef.current
      if (!api) return
      const text = e.clipboardData?.getData('text')
      if (!text) return
      e.preventDefault()
      const parsedRows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd().split('\n').map(r => r.split('\t'))
      const allCols = api.getAllDisplayedColumns()
      const cells = selectedCellsRef.current
      const focused = api.getFocusedCell()
      let startRow: number, startCol: number
      if (cells.size > 0) {
        let minRow = Infinity, minCol = Infinity
        cells.forEach(key => {
          const [r, c] = key.split(',').map(Number)
          minRow = Math.min(minRow, r); minCol = Math.min(minCol, c)
        })
        startRow = minRow; startCol = minCol
      } else if (focused) {
        startRow = focused.rowIndex
        startCol = allCols.findIndex(c => c.getColId() === focused.column.getColId())
      } else {
        return
      }
      parsedRows.forEach((rowVals, rOff) => {
        const node = api.getDisplayedRowAtIndex(startRow + rOff)
        if (!node) return
        rowVals.forEach((val, cOff) => {
          const col = allCols[startCol + cOff]
          if (!col) return
          const field = col.getColDef().field
          if (!field || NON_EDITABLE_FIELDS.has(field)) return
          node.setDataValue(field, val === '' ? null : val)
        })
      })
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [canEdit])

  const onCellFocused = (e: CellFocusedEvent) => {
    if (mousedownOccurredRef.current) { mousedownOccurredRef.current = false; return }
    if (shiftHeldRef.current) return
    if (e.rowIndex == null || !e.column) return
    const colId = (e.column as any).getColId?.()
    if (!colId) return
    const colIdx = getColIdx(colId)
    if (colIdx < 0) return
    ctrlCellsRef.current.clear()
    shiftRangeRef.current = { startRow: e.rowIndex, endRow: e.rowIndex, startColIdx: colIdx, endColIdx: colIdx }
    anchorRef.current = { row: e.rowIndex, col: colIdx }
    rebuildSelection()
    scheduleRefresh()
  }

  const onCellMouseDown = (e: any) => {
    mousedownOccurredRef.current = true
    const colIdx = getColIdx(e.column?.getColId?.() ?? '')
    const rowIdx: number = e.rowIndex ?? 0
    if (e.event?.shiftKey) {
      const anchor = anchorRef.current ?? { row: rowIdx, col: colIdx }
      shiftRangeRef.current = { startRow: anchor.row, endRow: rowIdx, startColIdx: anchor.col, endColIdx: colIdx }
      anchorRef.current = anchor
    } else if (e.event?.ctrlKey || e.event?.metaKey) {
      const key = cellKey(rowIdx, colIdx)
      if (ctrlCellsRef.current.has(key)) ctrlCellsRef.current.delete(key)
      else { ctrlCellsRef.current.add(key); anchorRef.current = { row: rowIdx, col: colIdx } }
    } else {
      ctrlCellsRef.current.clear()
      shiftRangeRef.current = { startRow: rowIdx, endRow: rowIdx, startColIdx: colIdx, endColIdx: colIdx }
      anchorRef.current = { row: rowIdx, col: colIdx }
      dragActiveRef.current = true
    }
    rebuildSelection()
    scheduleRefresh()
  }

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    filter: ExcelStyleFilter,
    cellStyle: (params: any) => {
      const rowIdx = params.node.rowIndex ?? -1
      const allCols = gridApiRef.current?.getAllDisplayedColumns() ?? []
      const colIdx = allCols.findIndex(c => c.getColId() === params.column.getColId())
      if (selectedCellsRef.current.has(cellKey(rowIdx, colIdx))) {
        return { backgroundColor: '#bfdbfe' }
      }
      const field = params.colDef.field as string
      if (field && !NON_EDITABLE_FIELDS.has(field) && !field.startsWith('_')) {
        const docId = params.data?._doc_id
        if (docId) {
          if (pendingEditsRef.current.has(`${docId}__${field}`)) {
            return { backgroundColor: '#fde68a' }
          }
          if (changedSetRef.current.has(`${docId}__${field}`)) {
            return { backgroundColor: '#fde68a' }
          }
        }
      }
      return { backgroundColor: '' }
    },
  }), [changedSetRef, pendingEditsRef])

  return (
    <div
      ref={containerRef}
      className="ag-theme-alpine"
      style={{ width: '100%', height: 'calc(100vh - 280px)', fontFamily: '"Calibri", Arial, sans-serif' }}
    >
      <AgGridReact
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        onGridReady={e => {
          gridApiRef.current = e.api
          e.api.addEventListener('undoCellEditing', onCellValueChanged)
          onGridReady(e.api)
        }}
        onCellValueChanged={onCellValueChanged}
        onCellFocused={onCellFocused}
        onCellMouseDown={onCellMouseDown}
        pagination={false}
        rowSelection="single"
        suppressRowClickSelection={true}
        animateRows={false}
        suppressHorizontalScroll={false}
        alwaysShowVerticalScroll={true}
        undoRedoCellEditing={true}
        undoRedoCellEditingLimit={50}
      />
    </div>
  )
}
