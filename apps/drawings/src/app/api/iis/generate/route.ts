import { NextRequest, NextResponse } from 'next/server'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

// ---------------------------------------------------------------------------
// Cell address + xlsx XML helpers (mirrors apps/iss/src/app/api/generate)
// ---------------------------------------------------------------------------

function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2]) }
}

function getElementsByTagNameLocal(parent: Element | Document, localName: string): Element[] {
  const out: Element[] = []
  function walk(node: Node) {
    if (!node) return
    if (node.nodeType === 1) {
      const el = node as Element
      if (el.localName === localName || el.nodeName?.split(':').pop() === localName) out.push(el)
    }
    if (!node.childNodes) return
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i])
  }
  walk(parent)
  return out
}

interface SheetInfo { name: string; sheetFile: string; rId: string }

async function getSheetInfos(zip: JSZip): Promise<SheetInfo[]> {
  const parser = new DOMParser()
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const wbDoc = parser.parseFromString(wbXml, 'text/xml')
  const sheets = getElementsByTagNameLocal(wbDoc, 'sheet')

  const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const wbRelsDoc = parser.parseFromString(wbRelsXml, 'text/xml')
  const rels = getElementsByTagNameLocal(wbRelsDoc, 'Relationship')
  const rIdMap: Record<string, string> = {}
  for (const rel of rels) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) rIdMap[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  }

  const out: SheetInfo[] = []
  for (const sh of sheets) {
    const name = sh.getAttribute('name') ?? ''
    const rId =
      sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
      sh.getAttribute('r:id') ??
      ''
    const sheetFile = rIdMap[rId] ?? ''
    if (sheetFile) out.push({ name, sheetFile, rId })
  }
  return out
}

// SheetIndex caches one DOM walk so subsequent cell writes are O(1) lookups.
// Without this, writing N cells over a sheet with M existing nodes is O(N*M);
// SA-2799 mode='all' (398 tags / 40 rows-per-page = 11 pages × ~240 writes)
// otherwise pushed shell's multi-zone proxy past its 30s socket headers
// timeout (ECONNRESET in shell logs) even though drawings eventually returned 200.
interface SheetIndex {
  doc: Document
  sheetData: Element
  ns: string | null
  rowMap: Map<number, Element>
  cellMaps: Map<number, Map<string, Element>>
}

function buildSheetIndex(doc: Document): SheetIndex | null {
  const sheetData = getElementsByTagNameLocal(doc, 'sheetData')[0]
  if (!sheetData) return null
  const rowMap = new Map<number, Element>()
  const cellMaps = new Map<number, Map<string, Element>>()
  for (const row of getElementsByTagNameLocal(sheetData, 'row')) {
    const rNum = parseInt(row.getAttribute('r') ?? '0')
    if (!rNum) continue
    rowMap.set(rNum, row)
    const cellMap = new Map<string, Element>()
    for (const c of getElementsByTagNameLocal(row, 'c')) {
      const ref = c.getAttribute('r')
      if (ref) cellMap.set(ref, c)
    }
    cellMaps.set(rNum, cellMap)
  }
  return { doc, sheetData, ns: sheetData.namespaceURI, rowMap, cellMaps }
}

function writeTextCell(idx: SheetIndex, cellRef: string, value: string): void {
  const parsed = parseCellRef(cellRef)
  if (!parsed) return
  const { doc, sheetData, ns, rowMap, cellMaps } = idx

  let targetRow = rowMap.get(parsed.row) ?? null
  if (!targetRow) {
    targetRow = doc.createElementNS(ns, 'row')
    targetRow.setAttribute('r', String(parsed.row))
    // Insert in order: find first row with r > parsed.row in the live DOM.
    // Done by scanning the rowMap keys (typically tiny — template rows only).
    let beforeRow: Element | null = null
    let beforeRowNum = Number.MAX_SAFE_INTEGER
    for (const [rNum, rEl] of rowMap) {
      if (rNum > parsed.row && rNum < beforeRowNum) { beforeRow = rEl; beforeRowNum = rNum }
    }
    if (beforeRow) sheetData.insertBefore(targetRow, beforeRow)
    else sheetData.appendChild(targetRow)
    rowMap.set(parsed.row, targetRow)
    cellMaps.set(parsed.row, new Map())
  }

  const cellMap = cellMaps.get(parsed.row)!
  let targetCell = cellMap.get(cellRef) ?? null
  if (!targetCell) {
    targetCell = doc.createElementNS(ns, 'c')
    targetCell.setAttribute('r', cellRef)
    let beforeCell: Element | null = null
    let beforeCol = Number.MAX_SAFE_INTEGER
    for (const [ref, cEl] of cellMap) {
      const cRef = parseCellRef(ref)
      if (cRef && cRef.col > parsed.col && cRef.col < beforeCol) { beforeCell = cEl; beforeCol = cRef.col }
    }
    if (beforeCell) targetRow.insertBefore(targetCell, beforeCell)
    else targetRow.appendChild(targetCell)
    cellMap.set(cellRef, targetCell)
  }

  targetCell.setAttribute('t', 'inlineStr')
  const toRemove: Node[] = []
  for (let i = 0; i < targetCell.childNodes.length; i++) {
    const n = targetCell.childNodes[i]
    if (n.nodeType === 1) {
      const name = (n as Element).localName
      if (name === 'v' || name === 'is' || name === 'f') toRemove.push(n)
    }
  }
  toRemove.forEach(n => targetCell!.removeChild(n))

  const isElem = doc.createElementNS(ns, 'is')
  const tElem = doc.createElementNS(ns, 't')
  tElem.textContent = value
  isElem.appendChild(tElem)
  targetCell.appendChild(isElem)
}

// ---------------------------------------------------------------------------
// Transform pipeline (mapping_rule.transform)
// ---------------------------------------------------------------------------

function applyTransform(value: string, transform: string | null): string {
  if (value == null) return ''
  if (!transform) return value
  const t = transform.trim()
  if (t.toUpperCase() === 'UPPER') return value.toUpperCase()
  if (t.toUpperCase() === 'LOWER') return value.toLowerCase()
  const dec = t.match(/^decimal:(\d+)$/i)
  if (dec) {
    const n = parseFloat(value)
    return Number.isNaN(n) ? value : n.toFixed(parseInt(dec[1]))
  }
  return value
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LayoutRow {
  template_code: string
  data_row_start: number
  data_row_end: number
  item_col_letter: string | null
  tag_col_letter: string
  page_no_cell: string | null
  rev_no_cells: string[] | null
  doc_no_cell: string | null
}

interface RawMapping {
  template_code: string
  output_column_letter: string
  output_label: string | null
  source_idx_column_id: number | null
  source_idx_column_ids: number[] | null
  source_iss_field_def_id: number | null
  source_constant: string | null
  concat_separator: string | null
  transform: string | null
  display_order: number
}

interface CompiledMapping {
  output_column_letter: string
  output_label: string | null
  kind: 'idx' | 'iss' | 'constant'
  idx_column_names: string[]
  concat_separator: string
  iss_field_id: number | null
  iss_field_name: string | null
  constant: string | null
  transform: string | null
}

type IssValueMap = Map<string, Map<number, string>>

interface ClassificationRule {
  template_code: string
  match_kind: 'prefix' | 'regex'
  match_value: string
  priority: number
}

interface TagRow {
  record_id: number
  tag_number: string
  loop_number: string | null
  loop_internal_order: string | null
  // jsonb values arrive as their native JS type — string | number | boolean | null
  // (and rarely nested objects). resolveValue coerces via String() before use.
  data: Record<string, unknown>
  total_count?: number
}

interface GenerateBody {
  template_code?: string                                     // required for single/all; ignored for auto
  filter?: { kind: 'loop_mid_letter'; value: string } | { kind: 'all' }
  page?: number                                              // 1-indexed; default 1. Ignored when mode!=single.
  mode?: 'single' | 'all' | 'auto'
  rev_no?: string
  doc_no?: string
}

// Convert 0-based index → Excel column letters (0=A, 25=Z, 26=AA, ...).
function colLetterFromIdx(n: number): string {
  let s = ''
  let x = n
  while (x >= 0) {
    s = String.fromCharCode(65 + (x % 26)) + s
    x = Math.floor(x / 26) - 1
  }
  return s
}

// ---------------------------------------------------------------------------
// Function key extraction + classification (mirror of drawings.tag_function_key
// + iis_classification_rule evaluation; preview UI uses the same logic).
// ---------------------------------------------------------------------------

function extractFunctionKey(tagNumber: string | null | undefined): string | null {
  if (!tagNumber) return null
  const segs = tagNumber.split('-')
  if (segs.length < 2) return null
  return segs[segs.length - 2] || null
}

// Sort rules by priority asc, then by longer match_value first, then rule order.
function sortRules(rules: ClassificationRule[]): ClassificationRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return b.match_value.length - a.match_value.length
  })
}

function classifyFunctionKey(fk: string | null, sortedRules: ClassificationRule[]): string | null {
  if (!fk) return null
  for (const r of sortedRules) {
    try {
      if (r.match_kind === 'prefix') {
        if (fk.startsWith(r.match_value)) return r.template_code
      } else {
        if (new RegExp(r.match_value).test(fk)) return r.template_code
      }
    } catch {
      // bad regex — skip (validated at save time)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Mapping compilation (idx column ids → names, iss field ids → names)
// ---------------------------------------------------------------------------

async function compileMappings(
  supabase: SupabaseClient,
  raw: RawMapping[],
): Promise<CompiledMapping[]> {
  const idxIdSet = new Set<number>()
  const issIdSet = new Set<number>()
  for (const m of raw) {
    if (m.source_idx_column_id != null) idxIdSet.add(m.source_idx_column_id)
    if (m.source_idx_column_ids) for (const id of m.source_idx_column_ids) idxIdSet.add(id)
    if (m.source_iss_field_def_id != null) issIdSet.add(m.source_iss_field_def_id)
  }

  const idxNameById = new Map<number, string>()
  if (idxIdSet.size) {
    const { data: cols } = await supabase
      .schema('idx').from('index_column').select('id, column_name').in('id', Array.from(idxIdSet))
    for (const c of cols ?? []) idxNameById.set(c.id as number, c.column_name as string)
  }
  const issNameById = new Map<number, string>()
  if (issIdSet.size) {
    const { data: flds } = await supabase
      .schema('iss').from('field_def').select('field_id, field_name').in('field_id', Array.from(issIdSet))
    for (const f of flds ?? []) issNameById.set(f.field_id as number, f.field_name as string)
  }

  return raw.map((m) => {
    let kind: 'idx' | 'iss' | 'constant' = 'constant'
    let idx_column_names: string[] = []
    let iss_field_id: number | null = null
    let iss_field_name: string | null = null
    if (m.source_idx_column_ids && m.source_idx_column_ids.length > 0) {
      kind = 'idx'
      idx_column_names = m.source_idx_column_ids
        .map(id => idxNameById.get(id))
        .filter((n): n is string => !!n)
    } else if (m.source_idx_column_id != null) {
      kind = 'idx'
      const n = idxNameById.get(m.source_idx_column_id)
      if (n) idx_column_names = [n]
    } else if (m.source_iss_field_def_id != null) {
      kind = 'iss'
      iss_field_id = m.source_iss_field_def_id
      iss_field_name = issNameById.get(m.source_iss_field_def_id) ?? null
    }
    return {
      output_column_letter: m.output_column_letter,
      output_label: m.output_label,
      kind,
      idx_column_names,
      concat_separator: m.concat_separator ?? ' ',
      iss_field_id,
      iss_field_name,
      constant: m.source_constant,
      transform: m.transform,
    }
  })
}

function collectIssFieldIds(mappings: CompiledMapping[]): number[] {
  const set = new Set<number>()
  for (const m of mappings) {
    if (m.kind === 'iss' && m.iss_field_id != null) set.add(m.iss_field_id)
  }
  return Array.from(set)
}

async function fetchIssValueMap(
  supabase: SupabaseClient,
  projectId: number,
  tagNumbers: string[],
  fieldIds: number[],
): Promise<IssValueMap> {
  const out: IssValueMap = new Map()
  if (tagNumbers.length === 0 || fieldIds.length === 0) {
    console.log('[iis/generate] fetchIssValueMap: empty input', { tags: tagNumbers.length, fields: fieldIds.length })
    return out
  }

  console.log('[iis/generate] fetchIssValueMap: calling RPC', {
    project: projectId,
    fieldIds,
    tagSample: tagNumbers.slice(0, 3),
    tagCount: tagNumbers.length,
  })

  const { data, error } = await supabase
    .schema('drawings')
    .rpc('iis_fetch_iss_values', {
      p_project_id: projectId,
      p_field_ids: fieldIds,
      p_tag_numbers: tagNumbers,
    })
  if (error) {
    console.error('[iis/generate] fetchIssValueMap RPC error', error)
    throw new Error(`ISS values fetch failed: ${error.message}`)
  }

  const rows = (Array.isArray(data) ? data : []) as Array<{
    tag_number: string | null
    field_id: number | null
    value_text: string | null
  }>
  console.log('[iis/generate] fetchIssValueMap: RPC returned', {
    rowCount: rows.length,
    sample: rows.slice(0, 3),
  })

  for (const r of rows) {
    if (!r.tag_number || r.field_id == null) continue
    let inner = out.get(r.tag_number)
    if (!inner) { inner = new Map(); out.set(r.tag_number, inner) }
    inner.set(r.field_id, r.value_text ?? '')
  }
  console.log('[iis/generate] fetchIssValueMap: map built', { tagsWithValues: out.size })
  return out
}

// ---------------------------------------------------------------------------
// Stamping helpers (work on a parsed sheet DOM)
// ---------------------------------------------------------------------------

function stampHeaderCells(idx: SheetIndex, L: LayoutRow, pageLabel: string | null, body: GenerateBody) {
  if (L.page_no_cell && pageLabel != null) {
    writeTextCell(idx, L.page_no_cell, pageLabel)
  }
  if (body.rev_no != null && body.rev_no !== '' && L.rev_no_cells) {
    for (const cell of L.rev_no_cells) writeTextCell(idx, cell, body.rev_no)
  }
  if (body.doc_no != null && body.doc_no !== '' && L.doc_no_cell) {
    writeTextCell(idx, L.doc_no_cell, body.doc_no)
  }
}

function resolveValue(m: CompiledMapping, tag: TagRow, issByTag: IssValueMap | null): string {
  let raw = ''
  if (m.kind === 'idx' && m.idx_column_names.length > 0) {
    const parts = m.idx_column_names
      .map(name => {
        const v = tag.data?.[name]
        if (v == null) return ''
        return String(v).trim()
      })
      .filter(v => v !== '')
    raw = parts.join(m.concat_separator)
  } else if (m.kind === 'iss' && m.iss_field_id != null) {
    const v = issByTag?.get(tag.tag_number)?.get(m.iss_field_id)
    raw = v != null ? String(v).trim() : ''
  } else if (m.kind === 'constant') {
    raw = m.constant ?? ''
  }
  return applyTransform(raw, m.transform)
}

function stampPageOntoSheet(
  idx: SheetIndex,
  mappings: CompiledMapping[],
  pageTags: TagRow[],
  L: LayoutRow,
  issByTag: IssValueMap | null,
): { stampedTags: number; overflowed: boolean } {
  let R = L.data_row_start
  let prevLoop: string | null = null
  let stampedTags = 0
  let overflowed = false

  for (const tag of pageTags) {
    if (prevLoop !== null && tag.loop_number !== prevLoop) R++ // blank row between loop groups
    if (R > L.data_row_end) { overflowed = true; break }
    for (const m of mappings) {
      writeTextCell(idx, `${m.output_column_letter}${R}`, resolveValue(m, tag, issByTag))
    }
    prevLoop = tag.loop_number
    R++
    stampedTags++
  }
  return { stampedTags, overflowed }
}

function buildMergedFlatSheet(
  sheetDoc: Document,
  mappings: CompiledMapping[],
  allTags: TagRow[],
  issByTag: IssValueMap | null,
): void {
  const worksheet = sheetDoc.documentElement
  const sheetData = getElementsByTagNameLocal(worksheet, 'sheetData')[0]
  if (!sheetData) return

  while (sheetData.firstChild) sheetData.removeChild(sheetData.firstChild)

  for (const localName of ['mergeCells', 'cols', 'autoFilter']) {
    for (const el of getElementsByTagNameLocal(worksheet, localName)) {
      el.parentNode?.removeChild(el)
    }
  }

  // Index a now-empty sheet so all subsequent writes append in O(1).
  const idx = buildSheetIndex(sheetDoc)
  if (!idx) return

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i]
    const label = m.output_label && m.output_label.trim() !== '' ? m.output_label : m.output_column_letter
    writeTextCell(idx, `${colLetterFromIdx(i)}1`, label)
  }

  for (let r = 0; r < allTags.length; r++) {
    const tag = allTags[r]
    for (let i = 0; i < mappings.length; i++) {
      const value = resolveValue(mappings[i], tag, issByTag)
      if (value === '') continue
      writeTextCell(idx, `${colLetterFromIdx(i)}${r + 2}`, value)
    }
  }
}

// ---------------------------------------------------------------------------
// CSV escape (UNCLASSIFIED report)
// ---------------------------------------------------------------------------

function csvCell(s: string | null | undefined): string {
  const v = s ?? ''
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
 try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = await getServerProjectId()
  if (projectId == null) return NextResponse.json({ error: 'No project selected' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profile').select('role').eq('id', user.id).single()
  if (!profile || profile.role === 'Pending') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: GenerateBody
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const filter = body.filter ?? { kind: 'all' }
  const midLetter = filter.kind === 'loop_mid_letter' ? filter.value : null
  const pageNum = Math.max(1, body.page ?? 1)
  const mode: 'single' | 'all' | 'auto' =
    body.mode === 'all' ? 'all' : body.mode === 'auto' ? 'auto' : 'single'

  const parser = new DOMParser()
  const serializer = new XMLSerializer()

  // -------------------------------------------------------------------------
  // Mode: auto — classify every tag into a template via iis_classification_rule,
  //              then render per-template per-page xlsx + MERGED.xlsx + a
  //              UNCLASSIFIED.csv report. Output a single ZIP.
  // -------------------------------------------------------------------------
  if (mode === 'auto') {
   try {
    // 1) Load all active templates + all mappings for project + all rules.
    const [
      { data: layoutsRaw, error: lErr },
      { data: rawMaps, error: mErr },
      { data: rulesRaw, error: rErr },
    ] = await Promise.all([
      supabase
        .schema('drawings')
        .from('iis_template_layout')
        .select('template_code, data_row_start, data_row_end, item_col_letter, tag_col_letter, page_no_cell, rev_no_cells, doc_no_cell')
        .eq('is_active', true),
      supabase
        .schema('drawings')
        .from('iis_column_mapping')
        .select('template_code, output_column_letter, output_label, source_idx_column_id, source_idx_column_ids, source_iss_field_def_id, source_constant, concat_separator, transform, display_order')
        .eq('project_id', projectId)
        .order('display_order'),
      supabase
        .schema('drawings')
        .from('iis_classification_rule')
        .select('template_code, match_kind, match_value, priority')
        .eq('project_id', projectId)
        .eq('is_active', true),
    ])
    if (lErr) return NextResponse.json({ error: `Layout load failed: ${lErr.message}` }, { status: 500 })
    if (mErr) return NextResponse.json({ error: `Mapping load failed: ${mErr.message}` }, { status: 500 })
    if (rErr) return NextResponse.json({ error: `Rule load failed: ${rErr.message}` }, { status: 500 })

    const layouts = (layoutsRaw ?? []) as LayoutRow[]
    const layoutByCode = new Map(layouts.map(L => [L.template_code, L]))
    const sortedRules = sortRules((rulesRaw ?? []) as ClassificationRule[])

    if (sortedRules.length === 0) {
      return NextResponse.json({ error: 'No classification rules. Define rules at /drawings/iis/classification first.' }, { status: 400 })
    }

    // 2) Compile mappings, grouped by template_code.
    const rawByTpl = new Map<string, RawMapping[]>()
    for (const m of (rawMaps ?? []) as RawMapping[]) {
      const arr = rawByTpl.get(m.template_code) ?? []
      arr.push(m)
      rawByTpl.set(m.template_code, arr)
    }
    const mappingsByTpl = new Map<string, CompiledMapping[]>()
    for (const [code, raw] of rawByTpl) {
      const compiled = await compileMappings(supabase, raw)
      mappingsByTpl.set(code, compiled)
    }

    // Projection columns: union across all templates' idx column names.
    const projectionCols = Array.from(new Set([
      '1_TAG NUMBER', '5_LOOP NUMBER', '11_INTERNAL LOOP ORDER',
      ...Array.from(mappingsByTpl.values()).flatMap(ms => ms.flatMap(m => m.idx_column_names)),
    ]))

    // 3) Single bulk fetch (migration 025 — single-row jsonb to dodge PostgREST
    //    row truncation); classify + bucket in JS.
    const { data: jsonResult, error: fetchErr } = await supabase
      .schema('drawings')
      .rpc('iis_fetch_all_tags_jsonb', {
        p_project_id: projectId,
        p_loop_mid_letter: midLetter,
        p_columns: projectionCols,
      })
    if (fetchErr) return NextResponse.json({ error: `Tag fetch failed: ${fetchErr.message}` }, { status: 500 })
    const bucketsByTpl = new Map<string, TagRow[]>()
    const unclassified: TagRow[] = []
    const allTagRows = (Array.isArray(jsonResult) ? jsonResult : []) as TagRow[]
    const totalFetched = allTagRows.length
    for (const t of allTagRows) {
      const fk = extractFunctionKey(t.tag_number)
      const tpl = classifyFunctionKey(fk, sortedRules)
      if (tpl && layoutByCode.has(tpl)) {
        const arr = bucketsByTpl.get(tpl) ?? []
        arr.push(t)
        bucketsByTpl.set(tpl, arr)
      } else {
        unclassified.push(t)
      }
    }

    if (totalFetched === 0) {
      return NextResponse.json({ error: `No tags (filter ${midLetter ?? 'all'})` }, { status: 400 })
    }

    // 3.5) Bulk-fetch ISS document_value for every tag that landed in any bucket,
    //      across the union of iss field_ids referenced by any template's mapping.
    //      Built once and shared across all templates.
    const allIssFieldIds = Array.from(new Set(
      Array.from(mappingsByTpl.values()).flatMap(collectIssFieldIds),
    ))
    const allBucketTagNumbers = Array.from(new Set(
      Array.from(bucketsByTpl.values()).flatMap(rows => rows.map(t => t.tag_number).filter(Boolean) as string[]),
    ))
    const issByTag = await fetchIssValueMap(supabase, projectId, allBucketTagNumbers, allIssFieldIds)

    // 4) Render per-template per-page xlsx + MERGED.xlsx into outer zip.
    const outerZip = new JSZip()
    const summary: string[] = []
    const filterTag = midLetter ? ` (loop_mid_letter=${midLetter})` : ''
    summary.push(`IIS auto-classification report${filterTag}`)
    summary.push(`Total tags fetched: ${totalFetched}`)
    summary.push(`Classification rules: ${sortedRules.length}`)
    summary.push('')

    const templateBufferCache = new Map<string, ArrayBuffer>()
    async function loadTemplateBuffer(code: string): Promise<ArrayBuffer | null> {
      const cached = templateBufferCache.get(code)
      if (cached) return cached
      const { data: blob } = await supabase.storage.from('templates').download(`iis/${code}.xlsx`)
      if (!blob) return null
      const buf = await blob.arrayBuffer()
      templateBufferCache.set(code, buf)
      return buf
    }

    let totalStamped = 0
    let anyOverflowed = false
    const usedTemplates: string[] = []

    for (const [code, tags] of Array.from(bucketsByTpl.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const L = layoutByCode.get(code)!
      const mappings = mappingsByTpl.get(code)
      if (!mappings || mappings.length === 0) {
        summary.push(`[${code}] SKIPPED — no column mappings defined (${tags.length} tags would route here)`)
        continue
      }
      const buf = await loadTemplateBuffer(code)
      if (!buf) {
        summary.push(`[${code}] SKIPPED — template xlsx not found in storage (${tags.length} tags would route here)`)
        continue
      }

      const rowsPerPage = L.data_row_end - L.data_row_start + 1
      const totalPages = Math.max(1, Math.ceil(tags.length / rowsPerPage))
      let tplStamped = 0
      let tplOverflowed = false

      for (let p = 1; p <= totalPages; p++) {
        const pageTags = tags.slice((p - 1) * rowsPerPage, p * rowsPerPage)
        const zip = await JSZip.loadAsync(buf)
        const sheetInfos = await getSheetInfos(zip)
        if (sheetInfos.length === 0) {
          summary.push(`[${code}] page ${p}: template has no worksheets — skipped`)
          continue
        }
        const firstSheet = sheetInfos[0]
        const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
        const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')

        const sheetIdx = buildSheetIndex(sheetDoc)
        if (!sheetIdx) {
          summary.push(`[${code}] page ${p}: sheetData not found — skipped`)
          continue
        }
        const { stampedTags, overflowed } = stampPageOntoSheet(sheetIdx, mappings, pageTags, L, issByTag)
        stampHeaderCells(sheetIdx, L, String(p).padStart(3, '0'), body)
        zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
        const bytes = await zip.generateAsync({ type: 'uint8array' })

        const pageName = `${code}/${code}_page${String(p).padStart(3, '0')}-of-${String(totalPages).padStart(3, '0')}.xlsx`
        outerZip.file(pageName, bytes)
        tplStamped += stampedTags
        if (overflowed) tplOverflowed = true
      }

      // MERGED.xlsx for this template
      {
        const zip = await JSZip.loadAsync(buf)
        const sheetInfos = await getSheetInfos(zip)
        if (sheetInfos.length > 0) {
          const firstSheet = sheetInfos[0]
          const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
          const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')
          buildMergedFlatSheet(sheetDoc, mappings, tags, issByTag)
          zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
          const bytes = await zip.generateAsync({ type: 'uint8array' })
          outerZip.file(`${code}/${code}_MERGED.xlsx`, bytes)
        }
      }

      totalStamped += tplStamped
      if (tplOverflowed) anyOverflowed = true
      usedTemplates.push(code)
      summary.push(
        `[${code}] tags=${tags.length}, pages=${totalPages}, stamped=${tplStamped}` +
        (tplOverflowed ? ' (OVERFLOWED — some pages exceeded data_row range)' : ''),
      )
    }

    // 5) UNCLASSIFIED.csv
    if (unclassified.length > 0) {
      const lines: string[] = ['tag_number,function_key,loop_number']
      for (const t of unclassified) {
        const fk = extractFunctionKey(t.tag_number) ?? ''
        lines.push([csvCell(t.tag_number), csvCell(fk), csvCell(t.loop_number)].join(','))
      }
      outerZip.file('UNCLASSIFIED.csv', lines.join('\r\n'))
      summary.push('')
      summary.push(`UNCLASSIFIED: ${unclassified.length} tags — see UNCLASSIFIED.csv`)
    } else {
      summary.push('')
      summary.push('UNCLASSIFIED: 0 tags')
    }

    outerZip.file('SUMMARY.txt', summary.join('\r\n') + '\r\n')

    const zipBytes = await outerZip.generateAsync({ type: 'uint8array' })
    const buf = Buffer.from(zipBytes)
    const zipName = `IIS_auto${midLetter ? `_${midLetter}` : ''}.zip`
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(buf.byteLength),
        'X-IIS-Total-Tags': String(totalFetched),
        'X-IIS-Stamped-Tags': String(totalStamped),
        'X-IIS-Unclassified': String(unclassified.length),
        'X-IIS-Templates': usedTemplates.join(','),
        'X-IIS-Overflowed': anyOverflowed ? '1' : '0',
      },
    })
   } catch (e) {
    console.error('[iis/generate auto]', e)
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return NextResponse.json({ error: `Auto generation failed — ${msg}` }, { status: 500 })
   }
  }

  // -------------------------------------------------------------------------
  // Mode: single | all — existing single-template flow
  // -------------------------------------------------------------------------
  const template_code = body.template_code
  if (!template_code) return NextResponse.json({ error: 'template_code required' }, { status: 400 })

  // 1) Layout
  const { data: layout, error: lErr } = await supabase
    .schema('drawings')
    .from('iis_template_layout')
    .select('template_code, data_row_start, data_row_end, item_col_letter, tag_col_letter, page_no_cell, rev_no_cells, doc_no_cell')
    .eq('template_code', template_code)
    .single()
  if (lErr || !layout) {
    return NextResponse.json({ error: `Template layout not found: ${template_code}` }, { status: 404 })
  }
  const L = layout as LayoutRow
  const rowsPerPage = L.data_row_end - L.data_row_start + 1

  // 2) Mappings (raw)
  const { data: rawMaps, error: mErr } = await supabase
    .schema('drawings')
    .from('iis_column_mapping')
    .select('template_code, output_column_letter, output_label, source_idx_column_id, source_idx_column_ids, source_iss_field_def_id, source_constant, concat_separator, transform, display_order')
    .eq('project_id', projectId)
    .eq('template_code', template_code)
    .order('display_order')
  if (mErr) return NextResponse.json({ error: `Mapping load failed: ${mErr.message}` }, { status: 500 })
  if (!rawMaps || rawMaps.length === 0) {
    return NextResponse.json({ error: `No mappings for ${template_code} in project ${projectId}` }, { status: 400 })
  }

  const mappings = await compileMappings(supabase, rawMaps as RawMapping[])

  // 3) Tag fetcher (paged rpc with column projection)
  const projectionCols = Array.from(new Set([
    '1_TAG NUMBER', '5_LOOP NUMBER', '11_INTERNAL LOOP ORDER',
    ...mappings.flatMap(m => m.idx_column_names),
  ]))

  async function fetchPage(p: number): Promise<{ tags: TagRow[]; totalTags: number } | { error: string }> {
    const { data, error } = await supabase
      .schema('drawings')
      .rpc('iis_fetch_tags_page', {
        p_project_id: projectId,
        p_loop_mid_letter: midLetter,
        p_columns: projectionCols,
        p_limit: rowsPerPage,
        p_offset: (p - 1) * rowsPerPage,
      })
    if (error) return { error: `Tag fetch failed: ${error.message}` }
    const tags = (data ?? []) as TagRow[]
    return { tags, totalTags: tags.length > 0 ? (tags[0].total_count ?? 0) : 0 }
  }

  // 4) Download template xlsx once; reload per page (JSZip mutates).
  const storagePath = `iis/${template_code}.xlsx`
  const { data: blob, error: dlErr } = await supabase.storage.from('templates').download(storagePath)
  if (dlErr || !blob) {
    return NextResponse.json({ error: `Template download failed: ${storagePath} - ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  }
  const templateBuffer = await blob.arrayBuffer()

  const issFieldIds = collectIssFieldIds(mappings)

  async function renderPageXlsx(
    pageTags: TagRow[],
    pageNum: number,
    issByTag: IssValueMap | null,
  ): Promise<{ bytes: Uint8Array; stampedTags: number; overflowed: boolean }> {
    const zip = await JSZip.loadAsync(templateBuffer)
    const sheetInfos = await getSheetInfos(zip)
    if (sheetInfos.length === 0) throw new Error('Template has no worksheets')
    const firstSheet = sheetInfos[0]
    const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')

    const sheetIdx = buildSheetIndex(sheetDoc)
    if (!sheetIdx) throw new Error('Template sheetData not found')
    const { stampedTags, overflowed } = stampPageOntoSheet(sheetIdx, mappings, pageTags, L, issByTag)
    stampHeaderCells(sheetIdx, L, String(pageNum).padStart(3, '0'), body)

    zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    return { bytes, stampedTags, overflowed }
  }

  async function renderMergedXlsx(allTags: TagRow[], issByTag: IssValueMap | null): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(templateBuffer)
    const sheetInfos = await getSheetInfos(zip)
    if (sheetInfos.length === 0) throw new Error('Template has no worksheets')
    const firstSheet = sheetInfos[0]
    const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')
    buildMergedFlatSheet(sheetDoc, mappings, allTags, issByTag)
    zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
    return zip.generateAsync({ type: 'uint8array' })
  }

  const filterTag = midLetter ? `_${midLetter}` : ''

  // Mode: single
  if (mode === 'single') {
    const r0 = await fetchPage(pageNum)
    if ('error' in r0) return NextResponse.json({ error: r0.error }, { status: 500 })
    if (r0.tags.length === 0) {
      return NextResponse.json({ error: `No tags on page ${pageNum} (filter ${midLetter ?? 'all'})` }, { status: 400 })
    }
    const totalTags = r0.totalTags
    const totalPages = Math.max(1, Math.ceil(totalTags / rowsPerPage))
    if (pageNum > totalPages) {
      return NextResponse.json({ error: `Page ${pageNum} out of range (total ${totalPages})` }, { status: 400 })
    }
    const tagNumbers = r0.tags.map(t => t.tag_number).filter(Boolean) as string[]
    const issByTag = await fetchIssValueMap(supabase, projectId, tagNumbers, issFieldIds)
    const { bytes, stampedTags, overflowed } = await renderPageXlsx(r0.tags, pageNum, issByTag)
    const buf = Buffer.from(bytes)
    const filename = `${template_code}${filterTag}_page${pageNum}-of-${totalPages}.xlsx`
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buf.byteLength),
        'X-IIS-Total-Tags': String(totalTags),
        'X-IIS-Total-Pages': String(totalPages),
        'X-IIS-Page': String(pageNum),
        'X-IIS-Stamped-Tags': String(stampedTags),
        'X-IIS-Overflowed': overflowed ? '1' : '0',
      },
    })
  }

  // Mode: all — apply classification rules to pull only the tags that route
  // to this template. Falls back to "all tags" only if no rules are defined
  // for this template (legacy behavior).
  const [
    { data: rulesRaw, error: rErr },
    { data: fkSummaryRaw, error: fkErr },
  ] = await Promise.all([
    supabase
      .schema('drawings')
      .from('iis_classification_rule')
      .select('template_code, match_kind, match_value, priority')
      .eq('project_id', projectId)
      .eq('is_active', true),
    supabase
      .schema('drawings')
      .rpc('iis_function_key_summary', { p_project_id: projectId }),
  ])
  if (rErr) return NextResponse.json({ error: `Rule load failed: ${rErr.message}` }, { status: 500 })
  if (fkErr) return NextResponse.json({ error: `Function-key summary failed: ${fkErr.message}` }, { status: 500 })

  const sortedRules = sortRules((rulesRaw ?? []) as ClassificationRule[])
  const allFunctionKeys = ((fkSummaryRaw ?? []) as Array<{ function_key: string }>).map(r => r.function_key)
  const matchedFks: string[] = []
  for (const fk of allFunctionKeys) {
    if (classifyFunctionKey(fk, sortedRules) === template_code) matchedFks.push(fk)
  }

  const hasRulesForThisTemplate = sortedRules.some(r => r.template_code === template_code)
  if (hasRulesForThisTemplate && matchedFks.length === 0) {
    return NextResponse.json({
      error: `No tag function keys route to ${template_code}. Check classification rules.`,
    }, { status: 400 })
  }

  const { data: bulkRows, error: bulkErr } = await supabase
    .schema('drawings')
    .rpc('iis_fetch_tags_by_function_keys', {
      p_project_id: projectId,
      p_function_keys: hasRulesForThisTemplate ? matchedFks : null,
      p_loop_mid_letter: midLetter,
      p_columns: projectionCols,
    })
  if (bulkErr) return NextResponse.json({ error: `Tag fetch failed: ${bulkErr.message}` }, { status: 500 })
  const allTags = (Array.isArray(bulkRows) ? bulkRows : []) as TagRow[]
  const totalTags = allTags.length
  if (totalTags === 0) {
    return NextResponse.json({ error: `No tags (filter ${midLetter ?? 'all'})` }, { status: 400 })
  }
  const totalPages = Math.max(1, Math.ceil(totalTags / rowsPerPage))

  const allTagNumbers = allTags.map(t => t.tag_number).filter(Boolean) as string[]
  const issByTag = await fetchIssValueMap(supabase, projectId, allTagNumbers, issFieldIds)

  const outerZip = new JSZip()
  let totalStamped = 0
  let anyOverflowed = false

  for (let p = 1; p <= totalPages; p++) {
    const pageTags = allTags.slice((p - 1) * rowsPerPage, p * rowsPerPage)
    if (pageTags.length === 0) break
    const { bytes, stampedTags, overflowed } = await renderPageXlsx(pageTags, p, issByTag)
    totalStamped += stampedTags
    if (overflowed) anyOverflowed = true
    const pageName = `${template_code}${filterTag}_page${String(p).padStart(3, '0')}-of-${String(totalPages).padStart(3, '0')}.xlsx`
    outerZip.file(pageName, bytes)
  }

  const mergedBytes = await renderMergedXlsx(allTags, issByTag)
  const mergedName = `${template_code}${filterTag}_MERGED.xlsx`
  outerZip.file(mergedName, mergedBytes)

  const zipBytes = await outerZip.generateAsync({ type: 'uint8array' })
  const zipName = `${template_code}${filterTag}_all.zip`

  const buf = Buffer.from(zipBytes)
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
      'Content-Length': String(buf.byteLength),
      'X-IIS-Total-Tags': String(totalTags),
      'X-IIS-Total-Pages': String(totalPages),
      'X-IIS-Stamped-Tags': String(totalStamped),
      'X-IIS-Overflowed': anyOverflowed ? '1' : '0',
    },
  })
 } catch (e) {
  console.error('[iis/generate]', e)
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return NextResponse.json({ error: `Generation failed — ${msg}` }, { status: 500 })
 }
}
