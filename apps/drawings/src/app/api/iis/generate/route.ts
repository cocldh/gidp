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
  // Preserve leading/trailing whitespace so user-supplied rev/doc with spaces
  // (e.g. " 0 ") survive round-trip — without this Excel collapses them.
  tElem.setAttribute('xml:space', 'preserve')
  tElem.textContent = value
  isElem.appendChild(tElem)
  targetCell.appendChild(isElem)
}

// ---------------------------------------------------------------------------
// Merged-cell handling
// ---------------------------------------------------------------------------

interface MergeRange {
  anchor: string         // top-left cellRef, e.g. "DD59"
  cells: Set<string>     // every cellRef covered by the merge
}

// Parse all <mergeCell ref="A1:B2"/> entries in the sheet. We need to know
// these because writing a value into a merge area's non-anchor cell is invalid
// per OOXML — Excel surfaces "We found a problem with some content. Do you
// want us to try to recover…" on open.
function loadMergeRanges(sheetDoc: Document): MergeRange[] {
  const out: MergeRange[] = []
  for (const mc of getElementsByTagNameLocal(sheetDoc, 'mergeCell')) {
    const ref = mc.getAttribute('ref')
    if (!ref) continue
    const [aRef, bRef] = ref.split(':')
    if (!aRef || !bRef) continue
    const a = parseCellRef(aRef.toUpperCase())
    const b = parseCellRef(bRef.toUpperCase())
    if (!a || !b) continue
    const minCol = Math.min(a.col, b.col)
    const maxCol = Math.max(a.col, b.col)
    const minRow = Math.min(a.row, b.row)
    const maxRow = Math.max(a.row, b.row)
    const anchor = `${colLetterFromIdx(minCol)}${minRow}`
    const cells = new Set<string>()
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cells.add(`${colLetterFromIdx(c)}${r}`)
      }
    }
    out.push({ anchor, cells })
  }
  return out
}

// If cellRef sits inside a merged range, return the anchor; otherwise return
// the original ref. Linear scan is fine — Aramco templates have ~10 merges.
function redirectToAnchor(cellRef: string, ranges: MergeRange[]): string {
  for (const r of ranges) {
    if (r.cells.has(cellRef)) return r.anchor
  }
  return cellRef
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
// Loop-type classification (mirror of iis_classification_rule evaluation;
// preview UI uses the same logic). Source: idx.index_record.data['7_LOOP TYPE'].
// ---------------------------------------------------------------------------

// Sort rules by priority asc, then by longer match_value first, then rule order.
function sortRules(rules: ClassificationRule[]): ClassificationRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return b.match_value.length - a.match_value.length
  })
}

function classifyLoopType(loopType: string | null, sortedRules: ClassificationRule[]): string | null {
  if (!loopType) return null
  for (const r of sortedRules) {
    try {
      if (r.match_kind === 'prefix') {
        if (loopType.startsWith(r.match_value)) return r.template_code
      } else {
        if (new RegExp(r.match_value).test(loopType)) return r.template_code
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

// Read xl/sharedStrings.xml as a flat array indexed by <si> position.
// A <si> can contain a single <t> or several <r><t> rich-text runs — we
// concatenate the text content so the final string matches what Excel renders.
async function loadSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml')
  if (!file) return []
  const xml = await file.async('string')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const out: string[] = []
  for (const si of getElementsByTagNameLocal(doc, 'si')) {
    const tNodes = getElementsByTagNameLocal(si, 't')
    out.push(tNodes.map(t => t.textContent ?? '').join(''))
  }
  return out
}

// Resolve the visible text of a cell. Handles t="s" (shared), t="inlineStr",
// and t="str" / untyped (formula result or raw string in <v>).
function getCellText(cell: Element, sharedStrings: string[]): string | null {
  const t = cell.getAttribute('t')
  if (t === 's') {
    const vEl = getElementsByTagNameLocal(cell, 'v')[0]
    if (!vEl) return null
    const sIdx = parseInt(vEl.textContent ?? '')
    if (Number.isNaN(sIdx) || sIdx < 0 || sIdx >= sharedStrings.length) return null
    return sharedStrings[sIdx]
  }
  if (t === 'inlineStr') {
    const isEl = getElementsByTagNameLocal(cell, 'is')[0]
    if (!isEl) return null
    return getElementsByTagNameLocal(isEl, 't').map(te => te.textContent ?? '').join('')
  }
  if (t === 'str' || t == null) {
    const vEl = getElementsByTagNameLocal(cell, 'v')[0]
    return vEl ? (vEl.textContent ?? null) : null
  }
  return null
}

type MatchMode = 'exact' | 'contains'

// Scan all cells in the sheet for ones whose trimmed text matches any of the
// given placeholder strings. Each placeholder picks its own match mode:
//   - 'exact'    — cell text == placeholder
//   - 'contains' — placeholder appears anywhere in cell text
// Returns Map<placeholder, cellRef[]>.
function findPlaceholderCells(
  idx: SheetIndex,
  sharedStrings: string[],
  modes: Map<string, MatchMode>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (modes.size === 0) return out
  for (const [, cellMap] of idx.cellMaps) {
    for (const [cellRef, cell] of cellMap) {
      const text = getCellText(cell, sharedStrings)
      if (text == null) continue
      const key = text.trim()
      for (const [placeholder, mode] of modes) {
        const hit = mode === 'exact' ? key === placeholder : key.includes(placeholder)
        if (!hit) continue
        const arr = out.get(placeholder) ?? []
        arr.push(cellRef)
        out.set(placeholder, arr)
      }
    }
  }
  return out
}

// Parse a definedName ref like "Sheet1!$A$1", "'My Sheet'!$A$1", or
// "Sheet1!$A$1:$B$2" (range). Returns the sheet name (null if workbook-scoped
// with no prefix) and an expanded list of cell refs.
function parseDefinedNameRef(ref: string): { sheetName: string | null; cellRefs: string[] } | null {
  let s = ref.trim()
  if (s.startsWith('=')) s = s.slice(1)
  let sheetName: string | null = null
  let rest = s
  const m = s.match(/^(?:'([^']+)'|([^!]+))!(.+)$/)
  if (m) {
    sheetName = m[1] ?? m[2] ?? null
    rest = m[3]
  }
  rest = rest.replace(/\$/g, '')
  if (rest.includes(':')) {
    const [a, b] = rest.split(':')
    const aP = parseCellRef(a.toUpperCase())
    const bP = parseCellRef(b.toUpperCase())
    if (!aP || !bP) return null
    const cellRefs: string[] = []
    const minCol = Math.min(aP.col, bP.col)
    const maxCol = Math.max(aP.col, bP.col)
    const minRow = Math.min(aP.row, bP.row)
    const maxRow = Math.max(aP.row, bP.row)
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cellRefs.push(`${colLetterFromIdx(c)}${r}`)
      }
    }
    return { sheetName, cellRefs }
  }
  const u = rest.toUpperCase()
  if (!/^[A-Z]+\d+$/.test(u)) return null
  return { sheetName, cellRefs: [u] }
}

interface DefinedNameEntry {
  name: string
  sheetName: string | null
  cellRefs: string[]
}

// Read xl/workbook.xml's <definedName> entries — Excel's "Name Box" entries.
// These are the named-range placeholders the user adds via Formulas → Define
// Name (or just typing into the Name Box). Critically these are NOT cell text
// and so cannot be found via sharedStrings.
async function loadDefinedNames(zip: JSZip): Promise<DefinedNameEntry[]> {
  const file = zip.file('xl/workbook.xml')
  if (!file) return []
  const xml = await file.async('string')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const out: DefinedNameEntry[] = []
  for (const dn of getElementsByTagNameLocal(doc, 'definedName')) {
    const name = dn.getAttribute('name') ?? ''
    if (!name) continue
    const refText = dn.textContent ?? ''
    const parsed = parseDefinedNameRef(refText)
    if (parsed) out.push({ name, sheetName: parsed.sheetName, cellRefs: parsed.cellRefs })
  }
  return out
}

// Collect cell refs for each requested placeholder by matching definedName
// entries scoped to the given sheet (case-insensitive sheet name compare;
// workbook-scoped names with no sheet prefix match every sheet). Each
// placeholder picks 'exact' or 'contains' for matching against definedName
// names — so REV_NUMBER with 'contains' also matches REV_NUMBER1, RV_REV_NUMBER
// etc. Result is keyed by the *placeholder* (not the matched name), so all
// REV_NUMBER variants stamp the rev value.
function definedNameMatches(
  entries: DefinedNameEntry[],
  sheetName: string,
  modes: Map<string, MatchMode>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const sLower = sheetName.toLowerCase()
  for (const e of entries) {
    if (e.sheetName && e.sheetName.toLowerCase() !== sLower) continue
    for (const [placeholder, mode] of modes) {
      const hit = mode === 'exact' ? e.name === placeholder : e.name.includes(placeholder)
      if (!hit) continue
      const arr = out.get(placeholder) ?? []
      for (const c of e.cellRefs) arr.push(c)
      out.set(placeholder, arr)
    }
  }
  return out
}

interface HeaderStampStats {
  sheet: { configured: number; placeholder: number }
  rev: { configured: number; placeholder: number }
  doc: { configured: number; placeholder: number }
}

// Stamp page-number, revision, and DCC values into the sheet. Values land in:
//   1) The cells configured in iis_template_layout (page_no_cell, rev_no_cells,
//      doc_no_cell) — original cell-address mapping.
//   2) Any cells matching one of three placeholder modes:
//      a) Cell text matching "SHEET_NUMBER" / "REV_NUMBER" / "DCC_NO"
//         (sharedStrings).
//      b) An Excel definedName (Name Box) matching that placeholder, scoped to
//         this sheet — these are NOT cell text, they live in xl/workbook.xml.
//      SHEET_NUMBER and DCC_NO match exact (single header slot each); REV_NUMBER
//      matches via 'contains' so variants like REV_NUMBER1, RV_REV_NUMBER also
//      get the rev value — typical Aramco IIS templates have multiple rev
//      slots per page.
async function stampHeaderCells(
  idx: SheetIndex,
  L: LayoutRow,
  pageLabel: string | null,
  body: GenerateBody,
  zip: JSZip,
  sheetName: string,
): Promise<HeaderStampStats> {
  const stats: HeaderStampStats = {
    sheet: { configured: 0, placeholder: 0 },
    rev: { configured: 0, placeholder: 0 },
    doc: { configured: 0, placeholder: 0 },
  }
  const wantSheet = pageLabel != null
  const wantRev = body.rev_no != null && body.rev_no !== ''
  const wantDoc = body.doc_no != null && body.doc_no !== ''
  if (!wantSheet && !wantRev && !wantDoc) return stats

  const modes = new Map<string, MatchMode>()
  if (wantSheet) modes.set('SHEET_NUMBER', 'exact')
  if (wantRev) modes.set('REV_NUMBER', 'contains')
  if (wantDoc) modes.set('DCC_NO', 'exact')

  const [sharedStrings, definedNames] = await Promise.all([
    loadSharedStrings(zip),
    loadDefinedNames(zip),
  ])
  const textCells = findPlaceholderCells(idx, sharedStrings, modes)
  const nameCells = definedNameMatches(definedNames, sheetName, modes)
  const mergeRanges = loadMergeRanges(idx.doc)

  // Merge text-cell and defined-name hits into a single per-placeholder set,
  // then redirect any cell that sits inside a merged area to the area's
  // anchor — writing to non-anchor cells in a merge causes Excel to surface
  // "We found a problem with some content" on open.
  function mergedCells(key: string): string[] {
    const out = new Set<string>()
    for (const c of textCells.get(key) ?? []) out.add(redirectToAnchor(c, mergeRanges))
    for (const c of nameCells.get(key) ?? []) out.add(redirectToAnchor(c, mergeRanges))
    return Array.from(out)
  }

  const totalMatched =
    mergedCells('SHEET_NUMBER').length +
    mergedCells('REV_NUMBER').length +
    mergedCells('DCC_NO').length
  console.log('[iis/generate header]', {
    template: L.template_code,
    page: pageLabel,
    sheet: sheetName,
    wanted: { sheet: wantSheet, rev: wantRev, doc: wantDoc },
    sharedStringCount: sharedStrings.length,
    definedNameCount: definedNames.length,
    matchedByText: {
      SHEET_NUMBER: textCells.get('SHEET_NUMBER') ?? [],
      REV_NUMBER: textCells.get('REV_NUMBER') ?? [],
      DCC_NO: textCells.get('DCC_NO') ?? [],
    },
    matchedByName: {
      SHEET_NUMBER: nameCells.get('SHEET_NUMBER') ?? [],
      REV_NUMBER: nameCells.get('REV_NUMBER') ?? [],
      DCC_NO: nameCells.get('DCC_NO') ?? [],
    },
    numberCandidates: totalMatched === 0
      ? sharedStrings.filter(s => /number|dcc/i.test(s)).slice(0, 20)
      : undefined,
  })

  if (wantSheet) {
    const cells = new Set<string>()
    if (L.page_no_cell) { cells.add(redirectToAnchor(L.page_no_cell, mergeRanges)); stats.sheet.configured = 1 }
    const matched = mergedCells('SHEET_NUMBER')
    for (const c of matched) cells.add(c)
    stats.sheet.placeholder = matched.length
    for (const c of cells) writeTextCell(idx, c, pageLabel!)
  }
  if (wantRev) {
    const cells = new Set<string>()
    if (L.rev_no_cells) for (const c of L.rev_no_cells) { cells.add(redirectToAnchor(c, mergeRanges)); stats.rev.configured++ }
    const matched = mergedCells('REV_NUMBER')
    for (const c of matched) cells.add(c)
    stats.rev.placeholder = matched.length
    for (const c of cells) writeTextCell(idx, c, body.rev_no!)
  }
  if (wantDoc) {
    const cells = new Set<string>()
    if (L.doc_no_cell) { cells.add(redirectToAnchor(L.doc_no_cell, mergeRanges)); stats.doc.configured = 1 }
    const matched = mergedCells('DCC_NO')
    for (const c of matched) cells.add(c)
    stats.doc.placeholder = matched.length
    for (const c of cells) writeTextCell(idx, c, body.doc_no!)
  }
  return stats
}

// Excel rebuilds xl/calcChain.xml automatically on next open. Leaving it
// stale (because we overwrote cells that previously held formulas) makes
// Excel show "Removed Records: Formula from /xl/calcChain.xml part" on open.
// Safest fix per OOXML practice is to drop the calcChain part entirely.
function dropCalcChain(zip: JSZip): void {
  zip.remove('xl/calcChain.xml')
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
    // 7_LOOP TYPE must be included for classification in JS after fetch.
    const projectionCols = Array.from(new Set([
      '1_TAG NUMBER', '5_LOOP NUMBER', '11_INTERNAL LOOP ORDER', '7_LOOP TYPE',
      ...Array.from(mappingsByTpl.values()).flatMap(ms => ms.flatMap(m => m.idx_column_names)),
    ]))

    // 3) Single bulk fetch (migration 025 — single-row jsonb to dodge PostgREST
    //    row truncation); classify + bucket in JS.
    const { data: jsonResult, error: fetchErr } = await supabase
      .schema('drawings')
      .rpc('iis_fetch_all_tags_jsonb', {
        p_project_id: projectId,
        p_loop_mid_letter: null,
        p_columns: projectionCols,
      })
    if (fetchErr) return NextResponse.json({ error: `Tag fetch failed: ${fetchErr.message}` }, { status: 500 })
    const bucketsByTpl = new Map<string, TagRow[]>()
    const unclassified: TagRow[] = []
    const allTagRows = (Array.isArray(jsonResult) ? jsonResult : []) as TagRow[]
    const totalFetched = allTagRows.length
    for (const t of allTagRows) {
      const loopType = t.data?.['7_LOOP TYPE'] != null ? String(t.data['7_LOOP TYPE']).trim() : null
      const tpl = classifyLoopType(loopType, sortedRules)
      if (tpl && layoutByCode.has(tpl)) {
        const arr = bucketsByTpl.get(tpl) ?? []
        arr.push(t)
        bucketsByTpl.set(tpl, arr)
      } else {
        unclassified.push(t)
      }
    }

    if (totalFetched === 0) {
      return NextResponse.json({ error: 'No tags' }, { status: 400 })
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
    summary.push('IIS auto-classification report')
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
    const headerStats: HeaderStampStats = {
      sheet: { configured: 0, placeholder: 0 },
      rev: { configured: 0, placeholder: 0 },
      doc: { configured: 0, placeholder: 0 },
    }

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
        const hStats = await stampHeaderCells(sheetIdx, L, String(p).padStart(3, '0'), body, zip, firstSheet.name)
        headerStats.sheet.configured += hStats.sheet.configured
        headerStats.sheet.placeholder += hStats.sheet.placeholder
        headerStats.rev.configured += hStats.rev.configured
        headerStats.rev.placeholder += hStats.rev.placeholder
        headerStats.doc.configured += hStats.doc.configured
        headerStats.doc.placeholder += hStats.doc.placeholder
        zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
        dropCalcChain(zip)
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
          dropCalcChain(zip)
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
      const lines: string[] = ['tag_number,loop_type,loop_number']
      for (const t of unclassified) {
        const lt = t.data?.['7_LOOP TYPE'] != null ? String(t.data['7_LOOP TYPE']).trim() : ''
        lines.push([csvCell(t.tag_number), csvCell(lt), csvCell(t.loop_number)].join(','))
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
    const zipName = 'IIS_auto.zip'
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
        'X-IIS-Header-Stamps': `sheet=${headerStats.sheet.configured}+${headerStats.sheet.placeholder}, rev=${headerStats.rev.configured}+${headerStats.rev.placeholder}, doc=${headerStats.doc.configured}+${headerStats.doc.placeholder}`,
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

  // 3) Tag fetcher — single + all both use classification-rule routing so the
  //    set of tags is exactly those that belong to this SA form. Loop mid
  //    letter is gone (the dropdown was orthogonal to template routing and
  //    caused timeouts on large projects).
  const projectionCols = Array.from(new Set([
    '1_TAG NUMBER', '5_LOOP NUMBER', '11_INTERNAL LOOP ORDER', '7_LOOP TYPE',
    ...mappings.flatMap(m => m.idx_column_names),
  ]))

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
  ): Promise<{ bytes: Uint8Array; stampedTags: number; overflowed: boolean; headerStats: HeaderStampStats }> {
    const zip = await JSZip.loadAsync(templateBuffer)
    const sheetInfos = await getSheetInfos(zip)
    if (sheetInfos.length === 0) throw new Error('Template has no worksheets')
    const firstSheet = sheetInfos[0]
    const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')

    const sheetIdx = buildSheetIndex(sheetDoc)
    if (!sheetIdx) throw new Error('Template sheetData not found')
    const { stampedTags, overflowed } = stampPageOntoSheet(sheetIdx, mappings, pageTags, L, issByTag)
    const headerStats = await stampHeaderCells(sheetIdx, L, String(pageNum).padStart(3, '0'), body, zip, firstSheet.name)

    zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
    dropCalcChain(zip)
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    return { bytes, stampedTags, overflowed, headerStats }
  }

  function formatHeaderStats(s: HeaderStampStats): string {
    return `sheet=${s.sheet.configured}+${s.sheet.placeholder}, rev=${s.rev.configured}+${s.rev.placeholder}, doc=${s.doc.configured}+${s.doc.placeholder}`
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
    dropCalcChain(zip)
    return zip.generateAsync({ type: 'uint8array' })
  }

  // Both single and all modes use the same classification-routed tag set —
  // single just slices one page out of it.
  const [
    { data: rulesRaw, error: rErr },
    { data: ltSummaryRaw, error: ltErr },
  ] = await Promise.all([
    supabase
      .schema('drawings')
      .from('iis_classification_rule')
      .select('template_code, match_kind, match_value, priority')
      .eq('project_id', projectId)
      .eq('is_active', true),
    supabase
      .schema('drawings')
      .rpc('iis_loop_type_summary', { p_project_id: projectId }),
  ])
  if (rErr) return NextResponse.json({ error: `Rule load failed: ${rErr.message}` }, { status: 500 })
  if (ltErr) return NextResponse.json({ error: `Loop-type summary failed: ${ltErr.message}` }, { status: 500 })

  const sortedRules = sortRules((rulesRaw ?? []) as ClassificationRule[])
  const allLoopTypes = ((ltSummaryRaw ?? []) as Array<{ loop_type: string }>).map(r => r.loop_type)
  const matchedLoopTypes: string[] = []
  for (const lt of allLoopTypes) {
    if (classifyLoopType(lt, sortedRules) === template_code) matchedLoopTypes.push(lt)
  }

  const hasRulesForThisTemplate = sortedRules.some(r => r.template_code === template_code)
  if (hasRulesForThisTemplate && matchedLoopTypes.length === 0) {
    return NextResponse.json({
      error: `No loop types route to ${template_code}. Check classification rules.`,
    }, { status: 400 })
  }

  const { data: bulkRows, error: bulkErr } = await supabase
    .schema('drawings')
    .rpc('iis_fetch_tags_by_loop_types', {
      p_project_id: projectId,
      p_loop_types: hasRulesForThisTemplate ? matchedLoopTypes : null,
      p_loop_mid_letter: null,
      p_columns: projectionCols,
    })
  if (bulkErr) return NextResponse.json({ error: `Tag fetch failed: ${bulkErr.message}` }, { status: 500 })
  const allTags = (Array.isArray(bulkRows) ? bulkRows : []) as TagRow[]
  const totalTags = allTags.length
  if (totalTags === 0) {
    return NextResponse.json({ error: `No tags route to ${template_code}` }, { status: 400 })
  }
  const totalPages = Math.max(1, Math.ceil(totalTags / rowsPerPage))

  // Mode: single — slice one page, render one xlsx.
  if (mode === 'single') {
    if (pageNum > totalPages) {
      return NextResponse.json({ error: `Page ${pageNum} out of range (total ${totalPages})` }, { status: 400 })
    }
    const pageTags = allTags.slice((pageNum - 1) * rowsPerPage, pageNum * rowsPerPage)
    const tagNumbers = pageTags.map(t => t.tag_number).filter(Boolean) as string[]
    const issByTag = await fetchIssValueMap(supabase, projectId, tagNumbers, issFieldIds)
    const { bytes, stampedTags, overflowed, headerStats } = await renderPageXlsx(pageTags, pageNum, issByTag)
    const buf = Buffer.from(bytes)
    const filename = `${template_code}_page${pageNum}-of-${totalPages}.xlsx`
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
        'X-IIS-Header-Stamps': formatHeaderStats(headerStats),
      },
    })
  }

  // Mode: all — every page + a MERGED.xlsx, zipped.
  const allTagNumbers = allTags.map(t => t.tag_number).filter(Boolean) as string[]
  const issByTag = await fetchIssValueMap(supabase, projectId, allTagNumbers, issFieldIds)

  const outerZip = new JSZip()
  let totalStamped = 0
  let anyOverflowed = false
  const aggHeaderStats: HeaderStampStats = {
    sheet: { configured: 0, placeholder: 0 },
    rev: { configured: 0, placeholder: 0 },
    doc: { configured: 0, placeholder: 0 },
  }

  for (let p = 1; p <= totalPages; p++) {
    const pageTags = allTags.slice((p - 1) * rowsPerPage, p * rowsPerPage)
    if (pageTags.length === 0) break
    const { bytes, stampedTags, overflowed, headerStats } = await renderPageXlsx(pageTags, p, issByTag)
    totalStamped += stampedTags
    if (overflowed) anyOverflowed = true
    aggHeaderStats.sheet.configured += headerStats.sheet.configured
    aggHeaderStats.sheet.placeholder += headerStats.sheet.placeholder
    aggHeaderStats.rev.configured += headerStats.rev.configured
    aggHeaderStats.rev.placeholder += headerStats.rev.placeholder
    aggHeaderStats.doc.configured += headerStats.doc.configured
    aggHeaderStats.doc.placeholder += headerStats.doc.placeholder
    const pageName = `${template_code}_page${String(p).padStart(3, '0')}-of-${String(totalPages).padStart(3, '0')}.xlsx`
    outerZip.file(pageName, bytes)
  }

  const mergedBytes = await renderMergedXlsx(allTags, issByTag)
  const mergedName = `${template_code}_MERGED.xlsx`
  outerZip.file(mergedName, mergedBytes)

  const zipBytes = await outerZip.generateAsync({ type: 'uint8array' })
  const zipName = `${template_code}_all.zip`

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
      'X-IIS-Header-Stamps': formatHeaderStats(aggHeaderStats),
    },
  })
 } catch (e) {
  console.error('[iis/generate]', e)
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return NextResponse.json({ error: `Generation failed — ${msg}` }, { status: 500 })
 }
}
