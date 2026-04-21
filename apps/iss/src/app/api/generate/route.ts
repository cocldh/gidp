import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MappingRuleRow {
  mapping_id: number
  template_id: number
  field_id: number
  data_type: string | null
  target_sheet: string | null
  target_cell: string | null
  remark: string | null
  field_def: { field_id: number; field_name: string } | null
  mapping_option: { option_id: number; mapping_id: number; expected_value: string | null }[]
}

interface DocInfo {
  document_id: number
  document_number: string
  template_id: number
  sheet_number: string | null
  revision_number: string | null
  tag_id: number | null
  template: { template_code: string } | null
}

// ---------------------------------------------------------------------------
// Cell address helpers
// ---------------------------------------------------------------------------

/** Parse "AG5" → { col: 32, row: 5 } (0-indexed col, 1-indexed row) */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2]) }
}

/** Convert 0-indexed column number to Excel letter(s): 0→A, 25→Z, 26→AA */
function colToLetter(c: number): string {
  let s = ''
  let n = c + 1
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function getChildElements(parent: Node): Element[] {
  const out: Element[] = []
  if (!parent?.childNodes) return out
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i]
    if (n.nodeType === 1) out.push(n as Element)
  }
  return out
}

function getElementsByTagNameLocal(parent: Element | Document, localName: string): Element[] {
  // getElementsByTagName doesn't work well with namespaced XML; walk the tree
  const out: Element[] = []
  function walk(node: Node) {
    if (!node) return
    if (node.nodeType === 1) {
      const el = node as Element
      if (el.localName === localName || el.nodeName?.split(':').pop() === localName) {
        out.push(el)
      }
    }
    if (!node.childNodes) return
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i])
  }
  walk(parent)
  return out
}

// ---------------------------------------------------------------------------
// Sheet name ↔ sheetN.xml mapping from workbook.xml + [Content_Types].xml
// ---------------------------------------------------------------------------

interface SheetInfo {
  name: string            // sheet tab name
  sheetFile: string       // e.g. "xl/worksheets/sheet1.xml"
  rId: string             // relationship id
  vmlDrawingFile: string | null  // e.g. "xl/drawings/vmlDrawing1.vml"
}

async function getSheetInfos(zip: JSZip): Promise<SheetInfo[]> {
  const parser = new DOMParser()

  // 1) Read workbook.xml for sheet names + rIds
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const wbDoc = parser.parseFromString(wbXml, 'text/xml')
  const sheets = getElementsByTagNameLocal(wbDoc, 'sheet')

  // 2) Read xl/_rels/workbook.xml.rels for rId → file mapping
  const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const wbRelsDoc = parser.parseFromString(wbRelsXml, 'text/xml')
  const rels = getElementsByTagNameLocal(wbRelsDoc, 'Relationship')
  const rIdMap: Record<string, string> = {}
  for (const rel of rels) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) rIdMap[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  }

  const infos: SheetInfo[] = []
  for (const sh of sheets) {
    const name = sh.getAttribute('name') ?? ''
    const rId = sh.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'
    ) ?? sh.getAttribute('r:id') ?? ''
    const sheetFile = rIdMap[rId] ?? ''
    if (!sheetFile) continue

    // 3) Check sheet-level rels for VML drawing
    let vmlDrawingFile: string | null = null
    const sheetRelsPath = sheetFile.replace(
      /^(xl\/worksheets\/)(.+)$/,
      '$1_rels/$2.rels'
    )
    const sheetRelsEntry = zip.file(sheetRelsPath)
    if (sheetRelsEntry) {
      const sheetRelsXml = await sheetRelsEntry.async('string')
      const sheetRelsDoc = parser.parseFromString(sheetRelsXml, 'text/xml')
      const sheetRels = getElementsByTagNameLocal(sheetRelsDoc, 'Relationship')
      for (const rel of sheetRels) {
        const target = rel.getAttribute('Target') ?? ''
        if (target.includes('vmlDrawing') && target.endsWith('.vml')) {
          vmlDrawingFile = target.startsWith('/')
            ? target.slice(1)
            : `xl/worksheets/${target}`.replace('worksheets/../', '')
          break
        }
      }
    }

    infos.push({ name, sheetFile, rId, vmlDrawingFile })
  }
  return infos
}

// ---------------------------------------------------------------------------
// TEXT cell writing — modify worksheet XML
// ---------------------------------------------------------------------------

function writeTextCell(
  doc: Document,
  cellRef: string,   // e.g. "AG5"
  value: string,
): void {
  const parsed = parseCellRef(cellRef)
  if (!parsed) return

  const sheetData = getElementsByTagNameLocal(doc, 'sheetData')[0]
  if (!sheetData) return

  // Find or create <row r="5">
  let targetRow: Element | null = null
  const rows = getElementsByTagNameLocal(sheetData, 'row')
  for (const row of rows) {
    if (row.getAttribute('r') === String(parsed.row)) {
      targetRow = row
      break
    }
  }

  if (!targetRow) {
    targetRow = doc.createElementNS(sheetData.namespaceURI, 'row')
    targetRow.setAttribute('r', String(parsed.row))

    // Insert in order
    let inserted = false
    for (const row of rows) {
      const rNum = parseInt(row.getAttribute('r') ?? '0')
      if (rNum > parsed.row) {
        sheetData.insertBefore(targetRow, row)
        inserted = true
        break
      }
    }
    if (!inserted) sheetData.appendChild(targetRow)
  }

  // Find or create <c r="AG5">
  let targetCell: Element | null = null
  const cells = getElementsByTagNameLocal(targetRow, 'c')
  for (const c of cells) {
    if (c.getAttribute('r') === cellRef) {
      targetCell = c
      break
    }
  }

  if (!targetCell) {
    targetCell = doc.createElementNS(sheetData.namespaceURI, 'c')
    targetCell.setAttribute('r', cellRef)

    // Insert cell in column order
    let inserted = false
    for (const c of cells) {
      const cRef = parseCellRef(c.getAttribute('r') ?? '')
      if (cRef && cRef.col > parsed.col) {
        targetRow.insertBefore(targetCell, c)
        inserted = true
        break
      }
    }
    if (!inserted) targetRow.appendChild(targetCell)
  }

  // Set as inline string: t="inlineStr" + <is><t>value</t></is>
  targetCell.setAttribute('t', 'inlineStr')
  // Remove any existing <v> or <is> children
  const toRemove: Node[] = []
  for (let i = 0; i < targetCell.childNodes.length; i++) {
    const n = targetCell.childNodes[i]
    if (n.nodeType === 1) {
      const name = (n as Element).localName
      if (name === 'v' || name === 'is' || name === 'f') toRemove.push(n)
    }
  }
  toRemove.forEach(n => targetCell!.removeChild(n))

  // Add <is><t>value</t></is>
  const ns = sheetData.namespaceURI
  const isElem = doc.createElementNS(ns, 'is')
  const tElem = doc.createElementNS(ns, 't')
  tElem.textContent = value
  isElem.appendChild(tElem)
  targetCell.appendChild(isElem)
}

// ---------------------------------------------------------------------------
// CHECKBOX manipulation — modify VML drawing XML
// ---------------------------------------------------------------------------

/**
 * Parse VML anchor string to get the cell position.
 * Anchor format: "LeftCol, LeftOffset, TopRow, TopOffset, RightCol, RightOffset, BottomRow, BottomOffset"
 * Returns { col: LeftCol (0-indexed), row: TopRow (0-indexed → we add 1 for Excel 1-indexed) }
 */
function parseVmlAnchor(anchor: string): { col: number; row: number } | null {
  const parts = anchor.split(',').map(s => parseInt(s.trim()))
  if (parts.length < 4 || isNaN(parts[0]) || isNaN(parts[2])) return null
  return { col: parts[0], row: parts[2] + 1 } // +1 to make 1-indexed row
}

function setCheckboxState(
  vmlDoc: Document,
  targetCells: Map<string, boolean>,  // cellRef → checked
): void {
  // Find all <x:ClientData ObjectType="Checkbox">
  const clientDatas = getElementsByTagNameLocal(vmlDoc, 'ClientData')

  for (const cd of clientDatas) {
    const objType = cd.getAttribute('ObjectType')
    if (objType !== 'Checkbox') continue

    // Find the anchor to determine position
    const anchorEls = getElementsByTagNameLocal(cd.parentNode as Element, 'Anchor')
    let anchorEl: Element | null = null
    // Try from ClientData first
    const cdAnchors = getElementsByTagNameLocal(cd, 'Anchor')
    if (cdAnchors.length > 0) {
      anchorEl = cdAnchors[0]
    } else if (anchorEls.length > 0) {
      anchorEl = anchorEls[0]
    }
    if (!anchorEl) continue

    const anchorText = anchorEl.textContent ?? ''
    const pos = parseVmlAnchor(anchorText)
    if (!pos) continue

    const cellRef = `${colToLetter(pos.col)}${pos.row}`

    // Check if this cell is in our target map
    if (!targetCells.has(cellRef)) continue

    const checked = targetCells.get(cellRef)!

    // Find or create <x:Checked> element inside ClientData
    const checkedEls = getElementsByTagNameLocal(cd, 'Checked')

    if (checked) {
      if (checkedEls.length > 0) {
        checkedEls[0].textContent = '1'
      } else {
        // Create <x:Checked>1</x:Checked>
        const checkedEl = vmlDoc.createElement('x:Checked')
        checkedEl.textContent = '1'
        cd.appendChild(checkedEl)
      }
    } else {
      // Remove <x:Checked> elements (unchecked = no element)
      for (const el of checkedEls) {
        cd.removeChild(el)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet deletion
// ---------------------------------------------------------------------------

async function deleteSheets(zip: JSZip, keepSheetNames: Set<string>): Promise<void> {
  const parser = new DOMParser()
  const serializer = new XMLSerializer()

  const infos = await getSheetInfos(zip)
  const toDelete = infos.filter(s => !keepSheetNames.has(s.name))

  for (const sheet of toDelete) {
    // Remove worksheet file
    zip.remove(sheet.sheetFile)
    // Remove rels file
    const relsPath = sheet.sheetFile.replace(
      /^(xl\/worksheets\/)(.+)$/,
      '$1_rels/$2.rels'
    )
    if (zip.file(relsPath)) zip.remove(relsPath)
    // Remove VML if any
    if (sheet.vmlDrawingFile && zip.file(sheet.vmlDrawingFile)) {
      zip.remove(sheet.vmlDrawingFile)
    }
  }

  if (toDelete.length === 0) return

  // Update workbook.xml: remove <sheet> entries
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const wbDoc = parser.parseFromString(wbXml, 'text/xml')
  const wbSheets = getElementsByTagNameLocal(wbDoc, 'sheet')
  const deleteRIds = new Set(toDelete.map(s => s.rId))
  for (const sh of wbSheets) {
    const rId = sh.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'
    ) ?? sh.getAttribute('r:id') ?? ''
    if (deleteRIds.has(rId)) {
      sh.parentNode?.removeChild(sh)
    }
  }
  zip.file('xl/workbook.xml', serializer.serializeToString(wbDoc))

  // Update xl/_rels/workbook.xml.rels: remove relationships
  const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const wbRelsDoc = parser.parseFromString(wbRelsXml, 'text/xml')
  const allRels = getElementsByTagNameLocal(wbRelsDoc, 'Relationship')
  for (const rel of allRels) {
    if (deleteRIds.has(rel.getAttribute('Id') ?? '')) {
      rel.parentNode?.removeChild(rel)
    }
  }
  zip.file('xl/_rels/workbook.xml.rels', serializer.serializeToString(wbRelsDoc))

  // Update [Content_Types].xml: remove entries for deleted sheets
  const ctFile = zip.file('[Content_Types].xml')
  if (ctFile) {
    const ctXml = await ctFile.async('string')
    const ctDoc = parser.parseFromString(ctXml, 'text/xml')
    const overrides = getElementsByTagNameLocal(ctDoc, 'Override')
    for (const ov of overrides) {
      const partName = ov.getAttribute('PartName') ?? ''
      for (const sheet of toDelete) {
        if (partName === `/${sheet.sheetFile}`) {
          ov.parentNode?.removeChild(ov)
        }
      }
    }
    zip.file('[Content_Types].xml', serializer.serializeToString(ctDoc))
  }
}

// ---------------------------------------------------------------------------
// Main document generation
// ---------------------------------------------------------------------------

async function generateDocument(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doc: DocInfo,
): Promise<{ filename: string; data: Uint8Array; error?: string } | { error: string }> {
  const templateCode = doc.template?.template_code
  if (!templateCode) return { error: `doc ${doc.document_id}: no template_code` }

  // 1. Download template from Supabase Storage (direct fetch with service role key)
  const storageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/templates/${encodeURIComponent(templateCode + '.xlsx')}`
  const dlRes = await fetch(storageUrl, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
  })

  if (!dlRes.ok) {
    const dlBody = await dlRes.text().catch(() => '')
    return { error: `doc ${doc.document_id}: template download failed (${templateCode}.xlsx) - ${dlRes.status} ${dlBody}` }
  }

  const templateBuffer = await dlRes.arrayBuffer()

  // 2. Fetch field values (with tag pooling)
  const { data: fieldValues } = await supabase
    .rpc('get_tag_field_values', { doc_id: doc.document_id })

  const valueMap: Record<string, string> = {}
  if (fieldValues) {
    for (const fv of fieldValues) {
      valueMap[fv.field_name] = fv.value_text
    }
  }

  // 3. Fetch mapping rules with options
  const { data: mappingRules, error: mapErr } = await supabase
    .from('mapping_rule')
    .select('*, field_def(field_id, field_name), mapping_option(*)')
    .eq('template_id', doc.template_id) as { data: MappingRuleRow[] | null; error: any }

  if (!mappingRules || mappingRules.length === 0) {
    return { error: `doc ${doc.document_id}: no mapping rules for template ${templateCode} (template_id=${doc.template_id})${mapErr ? ' - ' + mapErr.message : ''}` }
  }

  // 4. Open xlsx with JSZip
  const zip = await JSZip.loadAsync(templateBuffer)
  const parser = new DOMParser()
  const serializer = new XMLSerializer()

  // 5. Get sheet info
  const sheetInfos = await getSheetInfos(zip)
  const sheetByName: Record<string, SheetInfo> = {}
  for (const si of sheetInfos) sheetByName[si.name] = si

  // 6. Group mappings by target_sheet
  const textMappings: Map<string, { cellRef: string; value: string }[]> = new Map()
  const cbMappings: Map<string, Map<string, boolean>> = new Map()

  for (const rule of mappingRules) {
    if (!rule.target_sheet || !rule.target_cell || !rule.field_def) continue

    const fieldName = rule.field_def.field_name
    const fieldValue = valueMap[fieldName] ?? ''
    const sheet = rule.target_sheet
    const cell = rule.target_cell

    if (rule.data_type === 'CHECKBOX' && rule.mapping_option && rule.mapping_option.length > 0) {
      // Checkbox: check if field value matches one of the expected values
      const checked = rule.mapping_option.some(
        opt => opt.expected_value !== null && opt.expected_value === fieldValue
      )
      if (!cbMappings.has(sheet)) cbMappings.set(sheet, new Map())
      cbMappings.get(sheet)!.set(cell, checked)
    } else {
      // Text value
      if (!textMappings.has(sheet)) textMappings.set(sheet, [])
      textMappings.get(sheet)!.push({ cellRef: cell, value: fieldValue })
    }
  }

  // 7. Apply mappings to each sheet
  const usedSheets = new Set<string>()

  for (const [sheetName, cells] of textMappings) {
    const si = sheetByName[sheetName]
    if (!si) continue
    usedSheets.add(sheetName)

    const xmlStr = await zip.file(si.sheetFile)!.async('string')
    const sheetDoc = parser.parseFromString(xmlStr, 'text/xml')

    for (const { cellRef, value } of cells) {
      writeTextCell(sheetDoc, cellRef, value)
    }

    zip.file(si.sheetFile, serializer.serializeToString(sheetDoc))
  }

  for (const [sheetName, cellMap] of cbMappings) {
    const si = sheetByName[sheetName]
    if (!si || !si.vmlDrawingFile) continue
    usedSheets.add(sheetName)

    const vmlEntry = zip.file(si.vmlDrawingFile)
    if (!vmlEntry) continue

    const vmlStr = await vmlEntry.async('string')
    const vmlDoc = parser.parseFromString(vmlStr, 'text/xml')

    setCheckboxState(vmlDoc, cellMap)

    zip.file(si.vmlDrawingFile, serializer.serializeToString(vmlDoc))
  }

  // Also keep sheets that have checkbox mappings applied via text
  for (const [sheetName] of cbMappings) usedSheets.add(sheetName)

  // 8. Delete unused sheets (only if we have used sheets to keep)
  if (usedSheets.size > 0) {
    await deleteSheets(zip, usedSheets)
  }

  // 9. Generate output
  const outputBuffer = await zip.generateAsync({ type: 'uint8array' })

  const safeName = doc.document_number.replace(/[^a-zA-Z0-9_\-. ]/g, '_')
  return {
    filename: `${safeName}.xlsx`,
    data: outputBuffer,
  }
}

// ---------------------------------------------------------------------------
// API handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role check (Engineer+)
  const { data: profile } = await supabase
    .from('user_profile')
    .select('role')
    .eq('id', user.id)
    .single()

  // Allow Admin globally; Active users are allowed (project-level access controlled by RLS)
  if (!profile || profile.role === 'Pending') {
    return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 })
  }

  // Parse request
  let body: { document_ids: number[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { document_ids } = body
  if (!Array.isArray(document_ids) || document_ids.length === 0) {
    return NextResponse.json({ error: 'document_ids must be a non-empty array' }, { status: 400 })
  }

  // Fetch document info
  const { data: docs, error: docsErr } = await supabase
    .from('document')
    .select('*, template(template_code)')
    .in('document_id', document_ids)

  if (docsErr || !docs || docs.length === 0) {
    return NextResponse.json({ error: 'Documents not found' }, { status: 404 })
  }

  // Generate each document
  const results: { filename: string; data: Uint8Array }[] = []
  const errors: string[] = []

  for (const doc of docs as DocInfo[]) {
    try {
      const result = await generateDocument(supabase, doc)
      if ('filename' in result && 'data' in result) {
        results.push(result as { filename: string; data: Uint8Array })
      } else {
        errors.push(result.error)
      }
    } catch (err) {
      const stack = err instanceof Error ? err.stack ?? err.message : 'Unknown error'
      errors.push(`Error: ${doc.document_number} - ${stack}`)
    }
  }

  if (results.length === 0) {
    return NextResponse.json(
      { error: 'No documents generated', details: errors },
      { status: 500 },
    )
  }

  // Single document → return xlsx directly
  if (results.length === 1) {
    return new NextResponse(Buffer.from(results[0].data), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${results[0].filename}"`,
      },
    })
  }

  // Multiple documents → zip them
  const outputZip = new JSZip()
  for (const r of results) {
    outputZip.file(r.filename, r.data)
  }
  const zipBuffer = await outputZip.generateAsync({ type: 'uint8array' })
  const zipName = `ISS_Forms_${new Date().toISOString().slice(0, 10)}.zip`

  return new NextResponse(Buffer.from(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    },
  })
}
