import { NextRequest, NextResponse } from 'next/server'
import { createClient, getServerProjectId } from '@/lib/supabase-server'
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

function writeTextCell(doc: Document, cellRef: string, value: string): void {
  const parsed = parseCellRef(cellRef)
  if (!parsed) return

  const sheetData = getElementsByTagNameLocal(doc, 'sheetData')[0]
  if (!sheetData) return

  let targetRow: Element | null = null
  const rows = getElementsByTagNameLocal(sheetData, 'row')
  for (const row of rows) {
    if (row.getAttribute('r') === String(parsed.row)) { targetRow = row; break }
  }

  if (!targetRow) {
    targetRow = doc.createElementNS(sheetData.namespaceURI, 'row')
    targetRow.setAttribute('r', String(parsed.row))
    let inserted = false
    for (const row of rows) {
      const rNum = parseInt(row.getAttribute('r') ?? '0')
      if (rNum > parsed.row) { sheetData.insertBefore(targetRow, row); inserted = true; break }
    }
    if (!inserted) sheetData.appendChild(targetRow)
  }

  let targetCell: Element | null = null
  const cells = getElementsByTagNameLocal(targetRow, 'c')
  for (const c of cells) {
    if (c.getAttribute('r') === cellRef) { targetCell = c; break }
  }

  if (!targetCell) {
    targetCell = doc.createElementNS(sheetData.namespaceURI, 'c')
    targetCell.setAttribute('r', cellRef)
    let inserted = false
    for (const c of cells) {
      const cRef = parseCellRef(c.getAttribute('r') ?? '')
      if (cRef && cRef.col > parsed.col) { targetRow.insertBefore(targetCell, c); inserted = true; break }
    }
    if (!inserted) targetRow.appendChild(targetCell)
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

  const ns = sheetData.namespaceURI
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
  idx_column_names: string[]      // empty for non-idx; one element for single-source idx
  concat_separator: string
  iss_field_name: string | null
  constant: string | null
  transform: string | null
}

interface TagRow {
  record_id: number
  tag_number: string
  loop_number: string | null
  loop_internal_order: string | null
  data: Record<string, string | null>
  total_count: number
}

interface GenerateBody {
  template_code: string
  filter?: { kind: 'loop_mid_letter'; value: string } | { kind: 'all' }
  page?: number                       // 1-indexed; default 1. Ignored when mode='all'.
  mode?: 'single' | 'all'             // 'all' → zip of per-page xlsx + a flat merged xlsx
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
// Stamping helpers (work on a parsed sheet DOM)
// ---------------------------------------------------------------------------

function stampHeaderCells(sheetDoc: Document, L: LayoutRow, pageLabel: string | null, body: GenerateBody) {
  if (L.page_no_cell && pageLabel != null) {
    writeTextCell(sheetDoc, L.page_no_cell, pageLabel)
  }
  if (body.rev_no != null && body.rev_no !== '' && L.rev_no_cells) {
    for (const cell of L.rev_no_cells) writeTextCell(sheetDoc, cell, body.rev_no)
  }
  if (body.doc_no != null && body.doc_no !== '' && L.doc_no_cell) {
    writeTextCell(sheetDoc, L.doc_no_cell, body.doc_no)
  }
}

// Resolve one tag's value for one mapping. Returns the transformed string.
function resolveValue(m: CompiledMapping, tag: TagRow): string {
  let raw = ''
  if (m.kind === 'idx' && m.idx_column_names.length > 0) {
    const parts = m.idx_column_names
      .map(name => ((tag.data?.[name] as string) ?? '').trim())
      .filter(v => v !== '')
    raw = parts.join(m.concat_separator)
  } else if (m.kind === 'iss' && m.iss_field_name) {
    raw = '' // iss source not wired up for MVP
  } else if (m.kind === 'constant') {
    raw = m.constant ?? ''
  }
  return applyTransform(raw, m.transform)
}

// Stamp one page worth of tags onto the template sheet between data_row_start
// and data_row_end. Inserts a blank row between consecutive tags whose
// loop_number differs (visual grouping).
function stampPageOntoSheet(
  sheetDoc: Document,
  mappings: CompiledMapping[],
  pageTags: TagRow[],
  L: LayoutRow,
): { stampedTags: number; overflowed: boolean } {
  let R = L.data_row_start
  let prevLoop: string | null = null
  let stampedTags = 0
  let overflowed = false

  for (const tag of pageTags) {
    if (prevLoop !== null && tag.loop_number !== prevLoop) R++ // blank row between loop groups
    if (R > L.data_row_end) { overflowed = true; break }
    for (const m of mappings) {
      writeTextCell(sheetDoc, `${m.output_column_letter}${R}`, resolveValue(m, tag))
    }
    prevLoop = tag.loop_number
    R++
    stampedTags++
  }
  return { stampedTags, overflowed }
}

// Build a "merged flat" sheet for cross-page Ctrl+F searches: clears the
// template's sheetData / mergeCells / cols (so leftover banner cells don't
// confuse readers), then writes a fresh header row + all tag rows in
// compacted A, B, C... columns ordered by display_order. No blank rows.
function buildMergedFlatSheet(
  sheetDoc: Document,
  mappings: CompiledMapping[],
  allTags: TagRow[],
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

  // Row 1: headers
  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i]
    const label = m.output_label && m.output_label.trim() !== '' ? m.output_label : m.output_column_letter
    writeTextCell(sheetDoc, `${colLetterFromIdx(i)}1`, label)
  }

  // Rows 2..N: data, one row per tag (no blank rows for filter/sort friendliness)
  for (let r = 0; r < allTags.length; r++) {
    const tag = allTags[r]
    for (let i = 0; i < mappings.length; i++) {
      const value = resolveValue(mappings[i], tag)
      if (value === '') continue
      writeTextCell(sheetDoc, `${colLetterFromIdx(i)}${r + 2}`, value)
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
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

  const { template_code } = body
  const filter = body.filter ?? { kind: 'all' }
  const pageNum = Math.max(1, body.page ?? 1)
  const mode: 'single' | 'all' = body.mode === 'all' ? 'all' : 'single'
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
    .select('output_column_letter, output_label, source_idx_column_id, source_idx_column_ids, source_iss_field_def_id, source_constant, concat_separator, transform, display_order')
    .eq('project_id', projectId)
    .eq('template_code', template_code)
    .order('display_order')
  if (mErr) return NextResponse.json({ error: `Mapping load failed: ${mErr.message}` }, { status: 500 })
  if (!rawMaps || rawMaps.length === 0) {
    return NextResponse.json({ error: `No mappings for ${template_code} in project ${projectId}` }, { status: 400 })
  }

  // 3) Resolve idx column ids → names, iss field ids → names.
  // Each mapping row either has source_idx_column_id (single) or source_idx_column_ids (array).
  const idxIdSet = new Set<number>()
  for (const m of rawMaps as RawMapping[]) {
    if (m.source_idx_column_id != null) idxIdSet.add(m.source_idx_column_id)
    if (m.source_idx_column_ids && m.source_idx_column_ids.length > 0) {
      for (const id of m.source_idx_column_ids) idxIdSet.add(id)
    }
  }
  const idxIds = Array.from(idxIdSet)
  const issIds = Array.from(new Set(rawMaps.filter(m => m.source_iss_field_def_id).map(m => m.source_iss_field_def_id))) as number[]

  const idxNameById = new Map<number, string>()
  if (idxIds.length) {
    const { data: cols } = await supabase
      .schema('idx').from('index_column').select('id, column_name').in('id', idxIds)
    for (const c of cols ?? []) idxNameById.set(c.id as number, c.column_name as string)
  }

  const issNameById = new Map<number, string>()
  if (issIds.length) {
    const { data: flds } = await supabase
      .schema('iss').from('field_def').select('field_id, field_name').in('field_id', issIds)
    for (const f of flds ?? []) issNameById.set(f.field_id as number, f.field_name as string)
  }

  const mappings: CompiledMapping[] = (rawMaps as RawMapping[]).map((m) => {
    let kind: 'idx' | 'iss' | 'constant' = 'constant'
    let idx_column_names: string[] = []
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
      iss_field_name = issNameById.get(m.source_iss_field_def_id) ?? null
    }
    return {
      output_column_letter: m.output_column_letter,
      output_label: m.output_label,
      kind,
      idx_column_names,
      concat_separator: m.concat_separator ?? ' ',
      iss_field_name,
      constant: m.source_constant,
      transform: m.transform,
    }
  })

  // 4) Tag fetcher (paged rpc with column projection)
  const midLetter = filter.kind === 'loop_mid_letter' ? filter.value : null
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
    return { tags, totalTags: tags.length > 0 ? tags[0].total_count : 0 }
  }

  // 5) Download template xlsx once; reload per page (JSZip mutates).
  const storagePath = `iis/${template_code}.xlsx`
  const { data: blob, error: dlErr } = await supabase.storage.from('templates').download(storagePath)
  if (dlErr || !blob) {
    return NextResponse.json({ error: `Template download failed: ${storagePath} - ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  }
  const templateBuffer = await blob.arrayBuffer()
  const parser = new DOMParser()
  const serializer = new XMLSerializer()

  // Render one page worth of tags into a fresh copy of the template.
  async function renderPageXlsx(pageTags: TagRow[], pageNum: number): Promise<{ bytes: Uint8Array; stampedTags: number; overflowed: boolean }> {
    const zip = await JSZip.loadAsync(templateBuffer)
    const sheetInfos = await getSheetInfos(zip)
    if (sheetInfos.length === 0) throw new Error('Template has no worksheets')
    const firstSheet = sheetInfos[0]
    const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')

    const { stampedTags, overflowed } = stampPageOntoSheet(sheetDoc, mappings, pageTags, L)
    stampHeaderCells(sheetDoc, L, String(pageNum).padStart(3, '0'), body)

    zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    return { bytes, stampedTags, overflowed }
  }

  // Render the merged flat sheet (all tags, single sheet, compacted columns).
  async function renderMergedXlsx(allTags: TagRow[]): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(templateBuffer)
    const sheetInfos = await getSheetInfos(zip)
    if (sheetInfos.length === 0) throw new Error('Template has no worksheets')
    const firstSheet = sheetInfos[0]
    const xmlStr = await zip.file(firstSheet.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')
    buildMergedFlatSheet(sheetDoc, mappings, allTags)
    zip.file(firstSheet.sheetFile, serializer.serializeToString(sheetDoc))
    return zip.generateAsync({ type: 'uint8array' })
  }

  const filterTag = filter.kind === 'loop_mid_letter' ? `_${filter.value}` : ''

  // ---------------------------------------------------------------------------
  // Mode: single
  // ---------------------------------------------------------------------------
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
    const { bytes, stampedTags, overflowed } = await renderPageXlsx(r0.tags, pageNum)
    const filename = `${template_code}${filterTag}_page${pageNum}-of-${totalPages}.xlsx`
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-IIS-Total-Tags': String(totalTags),
        'X-IIS-Total-Pages': String(totalPages),
        'X-IIS-Page': String(pageNum),
        'X-IIS-Stamped-Tags': String(stampedTags),
        'X-IIS-Overflowed': overflowed ? '1' : '0',
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Mode: all — zip of per-page xlsx + flat merged xlsx
  // ---------------------------------------------------------------------------
  const r0 = await fetchPage(1)
  if ('error' in r0) return NextResponse.json({ error: r0.error }, { status: 500 })
  if (r0.tags.length === 0) {
    return NextResponse.json({ error: `No tags (filter ${midLetter ?? 'all'})` }, { status: 400 })
  }
  const totalTags = r0.totalTags
  const totalPages = Math.max(1, Math.ceil(totalTags / rowsPerPage))

  const outerZip = new JSZip()
  const allTags: TagRow[] = []
  let totalStamped = 0
  let anyOverflowed = false

  for (let p = 1; p <= totalPages; p++) {
    const pageRes = p === 1 ? r0 : await fetchPage(p)
    if ('error' in pageRes) return NextResponse.json({ error: pageRes.error }, { status: 500 })
    if (pageRes.tags.length === 0) break
    allTags.push(...pageRes.tags)
    const { bytes, stampedTags, overflowed } = await renderPageXlsx(pageRes.tags, p)
    totalStamped += stampedTags
    if (overflowed) anyOverflowed = true
    const pageName = `${template_code}${filterTag}_page${String(p).padStart(3, '0')}-of-${String(totalPages).padStart(3, '0')}.xlsx`
    outerZip.file(pageName, bytes)
  }

  const mergedBytes = await renderMergedXlsx(allTags)
  const mergedName = `${template_code}${filterTag}_MERGED.xlsx`
  outerZip.file(mergedName, mergedBytes)

  const zipBytes = await outerZip.generateAsync({ type: 'uint8array' })
  const zipName = `${template_code}${filterTag}_all.zip`

  return new NextResponse(Buffer.from(zipBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
      'X-IIS-Total-Tags': String(totalTags),
      'X-IIS-Total-Pages': String(totalPages),
      'X-IIS-Stamped-Tags': String(totalStamped),
      'X-IIS-Overflowed': anyOverflowed ? '1' : '0',
    },
  })
}
