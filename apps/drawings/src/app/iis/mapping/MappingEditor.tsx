'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

interface TemplateLayout {
  template_code: string
  description: string | null
  banner_text: string
  data_row_start: number
  data_row_end: number
  item_col_letter: string | null
  tag_col_letter: string
}

interface IdxColumn {
  id: number
  column_name: string
}
interface IssField {
  field_id: number
  field_name: string
}

type SourceKind = 'idx' | 'iss' | 'constant'

interface Mapping {
  mapping_id?: number
  output_column_letter: string
  output_label: string
  source_kind: SourceKind
  // For idx kind, idx_column_ids is the canonical source list. Length 1 = single
  // idx column; length 2+ = concatenate idx values with concat_separator. The
  // legacy scalar source_idx_column_id is kept on save for back-compat only
  // when the array has exactly one entry.
  idx_column_ids: (number | null)[]
  concat_separator: string
  source_iss_field_def_id: number | null
  source_constant: string | null
  transform: string | null
  display_order: number
}

interface Props {
  projectId: number
  templates: TemplateLayout[]
}

const COL_LETTER_RE = /^[A-Z]{1,2}$/

// Single-line <input> can't hold the embedded newlines that exist in some idx
// column names (e.g. "36_INSTRUMENT MOUNTING DRAWING NO.\n(POINTS AND LINES LAYOUT)").
// Browsers replace \n with a space when populating from <datalist>, so strict
// equality on column_name fails. Compare on a whitespace-collapsed canonical form.
function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function deriveKind(m: {
  source_idx_column_id: number | null
  source_idx_column_ids: number[] | null
  source_iss_field_def_id: number | null
  source_constant: string | null
}): SourceKind {
  if (m.source_idx_column_id != null || (m.source_idx_column_ids && m.source_idx_column_ids.length > 0)) return 'idx'
  if (m.source_iss_field_def_id != null) return 'iss'
  return 'constant'
}

function emptyMapping(displayOrder: number): Mapping {
  return {
    output_column_letter: '',
    output_label: '',
    source_kind: 'idx',
    idx_column_ids: [null],
    concat_separator: ' ',
    source_iss_field_def_id: null,
    source_constant: null,
    transform: null,
    display_order: displayOrder,
  }
}

export default function MappingEditor({ projectId, templates }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [selected, setSelected] = useState<string>(templates[0]?.template_code ?? '')
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [idxColumns, setIdxColumns] = useState<IdxColumn[]>([])
  const [issFields, setIssFields] = useState<IssField[]>([])
  const [loading, setLoading] = useState(true)
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const layout = templates.find((t) => t.template_code === selected) ?? null

  useEffect(() => { loadSources() }, [projectId])
  useEffect(() => { if (selected) loadMappings(selected) }, [selected])

  async function loadSources() {
    const [{ data: idx }, { data: iss }] = await Promise.all([
      supabase.schema('idx').from('index_column')
        .select('id, column_name').eq('project_id', projectId).order('order_index'),
      supabase.schema('iss').from('field_def')
        .select('field_id, field_name').eq('project_id', projectId).order('field_name'),
    ])
    setIdxColumns((idx ?? []) as IdxColumn[])
    setIssFields((iss ?? []) as IssField[])
  }

  async function loadMappings(code: string) {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .schema('drawings')
      .from('iis_column_mapping')
      .select('*')
      .eq('project_id', projectId)
      .eq('template_code', code)
      .order('display_order')
      .order('output_column_letter')
    if (error) { setError(error.message); setLoading(false); return }
    const rows = (data ?? []).map((r) => {
      const arr = (r.source_idx_column_ids as number[] | null) ?? null
      let idxIds: (number | null)[]
      if (arr && arr.length > 0) idxIds = arr
      else if (r.source_idx_column_id != null) idxIds = [r.source_idx_column_id as number]
      else idxIds = [null]
      return {
        mapping_id: r.mapping_id as number,
        output_column_letter: r.output_column_letter,
        output_label: r.output_label ?? '',
        source_kind: deriveKind(r),
        idx_column_ids: idxIds,
        concat_separator: (r.concat_separator as string) ?? ' ',
        source_iss_field_def_id: r.source_iss_field_def_id,
        source_constant: r.source_constant,
        transform: r.transform,
        display_order: r.display_order,
      }
    })
    setMappings(rows as Mapping[])
    setLoading(false)
  }

  function updateRow(i: number, patch: Partial<Mapping>) {
    setMappings((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function changeKind(i: number, kind: SourceKind) {
    updateRow(i, {
      source_kind: kind,
      idx_column_ids: kind === 'idx' ? [null] : [],
      source_iss_field_def_id: null,
      source_constant: kind === 'constant' ? '' : null,
    })
  }

  function addRow() {
    setMappings((rows) => [...rows, emptyMapping(rows.length ? Math.max(...rows.map((r) => r.display_order)) + 10 : 0)])
  }

  async function saveRow(i: number) {
    const r = mappings[i]
    const letter = r.output_column_letter.toUpperCase().trim()
    if (!COL_LETTER_RE.test(letter)) { setError(`Row ${i + 1}: output column must be 1-2 uppercase letters`); return }
    const idxIds = r.idx_column_ids.filter((id): id is number => id != null)
    if (r.source_kind === 'idx' && idxIds.length === 0) { setError(`Row ${i + 1}: select an idx column`); return }
    if (r.source_kind === 'iss' && !r.source_iss_field_def_id) { setError(`Row ${i + 1}: select an iss field`); return }
    if (r.source_kind === 'constant' && (r.source_constant ?? '') === '') { setError(`Row ${i + 1}: enter a constant value`); return }

    setSavingRow(i)
    setError(null)
    // Scalar vs array: single idx uses the legacy scalar column (with array NULL)
    // to satisfy the iis_col_mapping_idx_scalar_xor_chk constraint. 2+ uses the
    // array column.
    const useArray = r.source_kind === 'idx' && idxIds.length >= 2
    const payload = {
      project_id: projectId,
      template_code: selected,
      output_column_letter: letter,
      output_label: r.output_label || null,
      source_idx_column_id: r.source_kind === 'idx' && !useArray ? idxIds[0] : null,
      source_idx_column_ids: useArray ? idxIds : null,
      concat_separator: useArray ? (r.concat_separator || ' ') : ' ',
      source_iss_field_def_id: r.source_kind === 'iss' ? r.source_iss_field_def_id : null,
      source_constant: r.source_kind === 'constant' ? r.source_constant : null,
      transform: r.transform || null,
      display_order: r.display_order,
    }
    const { data, error } = await supabase
      .schema('drawings')
      .from('iis_column_mapping')
      .upsert(payload, { onConflict: 'project_id,template_code,output_column_letter' })
      .select('mapping_id')
      .single()
    setSavingRow(null)
    if (error) { setError(error.message); return }
    updateRow(i, { mapping_id: data?.mapping_id, output_column_letter: letter })
  }

  async function deleteRow(i: number) {
    const r = mappings[i]
    if (r.mapping_id) {
      const { error } = await supabase
        .schema('drawings')
        .from('iis_column_mapping')
        .delete()
        .eq('mapping_id', r.mapping_id)
      if (error) { setError(error.message); return }
    }
    setMappings((rows) => rows.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-4">
      {/* Template picker */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="block text-xs uppercase tracking-wider text-gray-400 mb-1">Template</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full md:w-2/3 border border-gray-300 rounded px-3 py-2 text-sm"
        >
          {templates.map((t) => (
            <option key={t.template_code} value={t.template_code}>
              {t.template_code} — {t.banner_text} {t.description ? `· ${t.description}` : ''}
            </option>
          ))}
        </select>
        {layout && (
          <div className="mt-2 text-xs text-gray-500">
            Data rows {layout.data_row_start}–{layout.data_row_end}
            {layout.item_col_letter ? ` · Item col ${layout.item_col_letter}` : ''}
            {' · '}Tag col {layout.tag_col_letter}
          </div>
        )}
      </div>

      {/* Sources hint */}
      <div className="text-xs text-gray-500 px-1">
        Sources loaded: <b>{idxColumns.length}</b> idx columns · <b>{issFields.length}</b> iss field_def. Type in the box to filter.
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
      )}

      {/* Mapping rows */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-xs">
            <tr>
              <th className="px-3 py-2 text-left w-16">Col</th>
              <th className="px-3 py-2 text-left w-48">Label</th>
              <th className="px-3 py-2 text-left w-28">Source</th>
              <th className="px-3 py-2 text-left">Source value</th>
              <th className="px-3 py-2 text-left w-32">Transform</th>
              <th className="px-3 py-2 text-left w-20">Order</th>
              <th className="px-3 py-2 text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : mappings.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No mappings yet. Click <b>+ Add column</b> below.</td></tr>
            ) : (
              mappings.map((m, i) => (
                <MappingRow
                  key={m.mapping_id ?? `new-${i}`}
                  row={m}
                  idxColumns={idxColumns}
                  issFields={issFields}
                  saving={savingRow === i}
                  onChange={(patch) => updateRow(i, patch)}
                  onKind={(k) => changeKind(i, k)}
                  onSave={() => saveRow(i)}
                  onDelete={() => deleteRow(i)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="px-4 py-2 bg-[#000080] text-white rounded text-sm hover:bg-[#000060]"
      >
        + Add column
      </button>

      {selected && <GeneratePanel templateCode={selected} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generate panel — produces one-page xlsx for the selected template.
// ---------------------------------------------------------------------------

function GeneratePanel({ templateCode }: { templateCode: string }) {
  const [midLetter, setMidLetter] = useState('P')
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'single' | 'all'>('single')
  const [revNo, setRevNo] = useState('')
  const [docNo, setDocNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<{ total: number; pages: number; page: number | null; stamped: number; overflowed: boolean; mode: 'single' | 'all' } | null>(null)

  async function generate() {
    setBusy(true)
    setErr(null)
    try {
      const filter = midLetter.trim()
        ? { kind: 'loop_mid_letter', value: midLetter.trim().toUpperCase() }
        : { kind: 'all' }
      const res = await fetch('/drawings/api/iis/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_code: templateCode,
          filter,
          mode,
          page: mode === 'single' ? page : undefined,
          rev_no: revNo.trim() || undefined,
          doc_no: docNo.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }))
        setErr(j.error ?? `HTTP ${res.status}`)
        return
      }
      const total = parseInt(res.headers.get('X-IIS-Total-Tags') ?? '0')
      const pages = parseInt(res.headers.get('X-IIS-Total-Pages') ?? '0')
      const pageHeader = res.headers.get('X-IIS-Page')
      const pageNo = pageHeader ? parseInt(pageHeader) : null
      const stamped = parseInt(res.headers.get('X-IIS-Stamped-Tags') ?? '0')
      const overflowed = (res.headers.get('X-IIS-Overflowed') ?? '0') === '1'
      setInfo({ total, pages, page: pageNo, stamped, overflowed, mode })

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `${templateCode}.${mode === 'all' ? 'zip' : 'xlsx'}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mt-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-400">Generate xlsx</div>
          <div className="text-sm text-gray-600">
            {mode === 'single'
              ? '한 페이지 xlsx 를 생성합니다.'
              : '전체 페이지를 zip 으로 묶어 다운로드합니다. zip 안에 페이지별 xlsx + 한 시트에 전체 행이 들어간 _MERGED.xlsx 포함.'}
          </div>
        </div>
      </div>
      <div className="mb-3 flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'single'} onChange={() => setMode('single')} />
          Single page
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
          All pages (zip + merged)
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Loop mid letter</label>
          <input
            type="text"
            value={midLetter}
            onChange={(e) => setMidLetter(e.target.value.toUpperCase().slice(0, 1))}
            placeholder="P (blank = all)"
            className="w-28 border border-gray-300 rounded px-2 py-1 text-sm font-mono uppercase"
            maxLength={1}
          />
        </div>
        {mode === 'single' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Page</label>
            <input
              type="number"
              value={page}
              min={1}
              onChange={(e) => setPage(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">REV. NO.</label>
          <input
            type="text"
            value={revNo}
            onChange={(e) => setRevNo(e.target.value)}
            placeholder="0"
            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">DCC No.</label>
          <input
            type="text"
            value={docNo}
            onChange={(e) => setDocNo(e.target.value)}
            placeholder="DCC-..."
            className="w-48 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Generating…' : mode === 'all' ? 'Generate zip & download' : 'Generate & download'}
        </button>
        {info && (
          <div className="text-xs text-gray-500">
            총 <b>{info.total}</b> tags · <b>{info.pages}</b> pages
            {info.mode === 'single' && info.page != null && <> · page <b>{info.page}</b></>}
            {' · '}stamped <b>{info.stamped}</b>
            {info.overflowed && <span className="ml-2 text-amber-600">⚠ overflow — 빈 행 때문에 일부 태그가 다음 페이지로 밀림</span>}
          </div>
        )}
      </div>
      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{err}</div>
      )}
    </div>
  )
}

interface RowProps {
  row: Mapping
  idxColumns: IdxColumn[]
  issFields: IssField[]
  saving: boolean
  onChange: (patch: Partial<Mapping>) => void
  onKind: (k: SourceKind) => void
  onSave: () => void
  onDelete: () => void
}

function IdxPicker({
  selectedId,
  idxColumns,
  listId,
  placeholder,
  onPick,
}: {
  selectedId: number | null
  idxColumns: IdxColumn[]
  listId: string
  placeholder: string
  onPick: (id: number | null) => void
}) {
  const selectedName = normalizeName(idxColumns.find((c) => c.id === selectedId)?.column_name ?? '')
  const [text, setText] = useState(selectedName)
  useEffect(() => { setText(selectedName) }, [selectedName])

  const findByText = (v: string) => {
    const n = normalizeName(v)
    return idxColumns.find((c) => normalizeName(c.column_name) === n)
  }

  return (
    <input
      type="text"
      list={listId}
      value={text}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        const match = findByText(v)
        if (match) onPick(match.id)
        else if (v === '') onPick(null)
      }}
      onBlur={() => { if (!findByText(text)) setText(selectedName) }}
      placeholder={placeholder}
      className={`w-full border rounded px-2 py-1 text-sm font-mono ${
        text && !findByText(text) ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
      }`}
    />
  )
}

function MappingRow({ row, idxColumns, issFields, saving, onChange, onKind, onSave, onDelete }: RowProps) {
  const idxListId = 'idx-cols'
  const issListId = 'iss-fields'

  const selectedIssRaw = issFields.find((f) => f.field_id === row.source_iss_field_def_id)?.field_name ?? ''
  const selectedIssName = normalizeName(selectedIssRaw)
  const [issText, setIssText] = useState(selectedIssName)
  useEffect(() => { setIssText(selectedIssName) }, [selectedIssName])

  const findIssByText = (v: string) => {
    const n = normalizeName(v)
    return issFields.find((f) => normalizeName(f.field_name) === n)
  }

  function setIdxAt(index: number, id: number | null) {
    const next = [...row.idx_column_ids]
    next[index] = id
    onChange({ idx_column_ids: next })
  }
  function addIdxSlot() {
    onChange({ idx_column_ids: [...row.idx_column_ids, null] })
  }
  function removeIdxSlot(index: number) {
    const next = row.idx_column_ids.filter((_, i) => i !== index)
    onChange({ idx_column_ids: next.length === 0 ? [null] : next })
  }

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/40">
      <td className="px-3 py-2">
        <input
          type="text"
          value={row.output_column_letter}
          onChange={(e) => onChange({ output_column_letter: e.target.value.toUpperCase() })}
          placeholder="B"
          maxLength={2}
          className="w-14 border border-gray-300 rounded px-2 py-1 text-sm uppercase font-mono"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={row.output_label}
          onChange={(e) => onChange({ output_label: e.target.value })}
          placeholder="REMARKS"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={row.source_kind}
          onChange={(e) => onKind(e.target.value as SourceKind)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="idx">idx col</option>
          <option value="iss">iss field</option>
          <option value="constant">constant</option>
        </select>
      </td>
      <td className="px-3 py-2">
        {row.source_kind === 'idx' && (
          <>
            <div className="space-y-1">
              {row.idx_column_ids.map((id, slotIdx) => (
                <div key={slotIdx} className="flex items-center gap-1">
                  <IdxPicker
                    selectedId={id}
                    idxColumns={idxColumns}
                    listId={idxListId}
                    placeholder={slotIdx === 0 ? 'type to search…' : `then…`}
                    onPick={(newId) => setIdxAt(slotIdx, newId)}
                  />
                  {row.idx_column_ids.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeIdxSlot(slotIdx)}
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                      title="Remove this idx"
                    >×</button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addIdxSlot}
                  className="px-2 py-0.5 text-xs text-[#000080] hover:bg-blue-50 rounded border border-[#000080]/30"
                >+ idx</button>
                {row.idx_column_ids.filter((x) => x != null).length >= 2 && (
                  <>
                    <span className="text-xs text-gray-400">sep</span>
                    <input
                      type="text"
                      value={row.concat_separator}
                      onChange={(e) => onChange({ concat_separator: e.target.value })}
                      placeholder=" "
                      className="w-16 border border-gray-300 rounded px-2 py-0.5 text-xs font-mono"
                    />
                  </>
                )}
              </div>
            </div>
            <datalist id={idxListId}>
              {idxColumns.map((c) => <option key={c.id} value={normalizeName(c.column_name)} />)}
            </datalist>
          </>
        )}
        {row.source_kind === 'iss' && (
          <>
            <input
              type="text"
              list={issListId}
              value={issText}
              onChange={(e) => {
                const v = e.target.value
                setIssText(v)
                const match = findIssByText(v)
                if (match) onChange({ source_iss_field_def_id: match.field_id })
                else if (v === '') onChange({ source_iss_field_def_id: null })
              }}
              onBlur={() => {
                if (!findIssByText(issText)) setIssText(selectedIssName)
              }}
              placeholder="type to search…"
              className={`w-full border rounded px-2 py-1 text-sm font-mono ${
                issText && !findIssByText(issText)
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-300'
              }`}
            />
            <datalist id={issListId}>
              {issFields.map((f) => <option key={f.field_id} value={normalizeName(f.field_name)} />)}
            </datalist>
          </>
        )}
        {row.source_kind === 'constant' && (
          <input
            type="text"
            value={row.source_constant ?? ''}
            onChange={(e) => onChange({ source_constant: e.target.value })}
            placeholder="fixed value"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={row.transform ?? ''}
          onChange={(e) => onChange({ transform: e.target.value || null })}
          placeholder="upper · decimal:2"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          value={row.display_order}
          onChange={(e) => onChange({ display_order: parseInt(e.target.value, 10) || 0 })}
          className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-2 py-1 mr-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
        >
          Delete
        </button>
      </td>
    </tr>
  )
}
