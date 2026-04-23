'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient, readProjectIdCookie } from '@/lib/supabase-client'
import { useUserRole } from './RoleGuard'
import type { DocumentRevision, DocumentRevisionDetail } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

interface DocumentFieldsProps {
  documentId: number
  tagId: number
  onRevisionCommit?: () => void
}

interface FieldValue {
  field_id: number
  field_name: string
  value_text: string
  display_order: number
  data_kind: string
  previous_value: string | null
  changed_at: string | null
  changed_by: string | null
}

// Matches local GUI _populate_form top-field order
const TOP_FIELD_ORDER: Record<string, number> = {
  'form number': 0,
  'instrument tag number': 1,
  'item': 2,
  'requisition number': 3,
  'service': 4,
  'p & id number': 5,
  'manufacturer': 6,
  'model number': 7,
  'document number': 8,
  'sheet number': 9,
}

const isNoteField = (f: FieldValue) => f.field_name.trim().toLowerCase().startsWith('note')

function fieldSortKey(f: FieldValue, orderMap?: Map<string, number>): [number, number] {
  const lower = f.field_name.trim().toLowerCase()
  if (lower in TOP_FIELD_ORDER) return [0, TOP_FIELD_ORDER[lower]]
  if (lower.startsWith('note')) return [2, 0]
  if (orderMap && orderMap.size > 0) {
    const idx = orderMap.get(f.field_name)
    return [1, idx !== undefined ? idx : 9999]
  }
  return [1, f.display_order ?? 9999]
}

// Sheet Number: zero-pad to 3 digits
function displayValue(fieldName: string, value: string): string {
  if (fieldName.trim().toLowerCase() === 'sheet number' && /^\d+$/.test(value.trim())) {
    return value.trim().padStart(3, '0')
  }
  return value
}

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

function currentRevisionDisplay(revNum: string | null, minorRev: string | null): string {
  return (revNum ?? '') + (minorRev ?? '')
}

interface RevisionWithDetails extends DocumentRevision {
  details?: DocumentRevisionDetail[]
  expanded?: boolean
}

export default function DocumentFields({ documentId, tagId, onRevisionCommit }: DocumentFieldsProps) {
  const baseSupabase = createClient()            // public schema (tag, auth)
  const supabase = baseSupabase.schema('iss')    // iss.* tables
  const { hasRole } = useUserRole()
  const canEdit = hasRole('Editor')
  const isAdmin = hasRole('Admin')
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)

  useEffect(() => {
    baseSupabase.auth.getUser().then(({ data }) => setCurrentUser(data.user))
    setProjectId(readProjectIdCookie())
  }, [])

  const [fields, setFields] = useState<FieldValue[]>([])
  const [editedValues, setEditedValues] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [reorderMode, setReorderMode] = useState(false)

  // Document metadata
  const [currentRevNumber, setCurrentRevNumber] = useState<string | null>(null)
  const [currentMinorRevision, setCurrentMinorRevision] = useState<string | null>(null)
  const [currentDocNumber, setCurrentDocNumber] = useState<string | null>(null)
  const [currentTagNumber, setCurrentTagNumber] = useState<string | null>(null)

  // Major Revision commit modal state
  const [showCommitModal, setShowCommitModal] = useState(false)
  const [commitRevNumber, setCommitRevNumber] = useState('')
  const [commitNote, setCommitNote] = useState('')
  const [commitRevDesc, setCommitRevDesc] = useState<string>('ISSUED FOR REVIEW')
  const [committing, setCommitting] = useState(false)
  const [availableDocNumbers, setAvailableDocNumbers] = useState<string[]>([])
  const [selectedDocNumber, setSelectedDocNumber] = useState<string>('')
  const [targetSheets, setTargetSheets] = useState<{ sheet: string; rev: string }[]>([])

  // Revision history panel state
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [revisions, setRevisions] = useState<RevisionWithDetails[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Rollback state
  const [rollbackTarget, setRollbackTarget] = useState<RevisionWithDetails | null>(null)
  const [rollingBack, setRollingBack] = useState(false)

  const loadFields = useCallback(async () => {
    setLoading(true)

    const { data: docData } = await supabase
      .from('document')
      .select('template_id, revision_number, minor_revision, document_number, template:template_id(template_code)')
      .eq('document_id', documentId)
      .single()
    const templateId = (docData as any)?.template_id as number | null
    const templateCode = (docData as any)?.template?.template_code as string | null
    const revNum = (docData as any)?.revision_number as string | null
    const minorRev = (docData as any)?.minor_revision as string | null
    const docNum = (docData as any)?.document_number as string | null
    setCurrentRevNumber(revNum)
    setCurrentMinorRevision(minorRev)
    setCurrentDocNumber(docNum)

    if (tagId) {
      const { data: tagData } = await baseSupabase
        .from('tag')
        .select('tag_number')
        .eq('tag_id', tagId)
        .maybeSingle()
      setCurrentTagNumber((tagData as any)?.tag_number ?? null)
    }

    let customOrder: string[] = []
    if (templateCode && projectId != null) {
      try {
        const res = await fetch(
          `/iss/api/column-order?form=${encodeURIComponent(templateCode)}&project_id=${projectId}`,
        )
        const json = await res.json()
        customOrder = json.order ?? []
      } catch {}
    }

    let mappingFieldIds: number[] = []
    if (templateId) {
      const { data: mappings } = await supabase
        .from('mapping_rule')
        .select('field_id')
        .eq('template_id', templateId)
      mappingFieldIds = [...new Set((mappings ?? []).map((m: any) => m.field_id as number))]
    }

    let fieldDefs: any[] = []
    const hasMappings = mappingFieldIds.length > 0
    if (hasMappings) {
      const { data: mFields } = await supabase
        .from('field_def')
        .select('field_id, field_name, display_order, data_kind')
        .in('field_id', mappingFieldIds)
      let defaultQuery = supabase
        .from('field_def')
        .select('field_id, field_name, display_order, data_kind')
        .eq('data_kind', 'default')
      if (projectId != null) defaultQuery = defaultQuery.eq('project_id', projectId)
      const { data: dFields } = await defaultQuery
      const fieldMap = new Map<number, any>()
      for (const f of [...(mFields ?? []), ...(dFields ?? [])]) fieldMap.set(f.field_id, f)
      fieldDefs = Array.from(fieldMap.values())
    } else {
      let allQuery = supabase
        .from('field_def')
        .select('field_id, field_name, display_order, data_kind')
      if (projectId != null) allQuery = allQuery.eq('project_id', projectId)
      const { data } = await allQuery
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('field_name')
      fieldDefs = data ?? []
    }

    const { data: docValues } = await supabase
      .from('document_value')
      .select('field_id, value_text')
      .eq('document_id', documentId)

    const { data: changeData } = await supabase
      .from('document_value_change')
      .select('field_id, previous_value, new_value, changed_at, changed_by')
      .eq('document_id', documentId)

    // Major revision 이후의 모든 minor 변경사항을 누적 표시 (time filter 없이 전체 DVC 사용)
    const changeMap = new Map((changeData ?? []).map(c => [c.field_id, c]))

    const { data: siblingDocs } = await supabase
      .from('document')
      .select('document_id')
      .eq('tag_id', tagId)
    const siblingIds = (siblingDocs ?? [])
      .map((d: any) => d.document_id as number)
      .filter((id) => id !== documentId)

    let pooledValues: Record<number, string> = {}
    if (siblingIds.length > 0) {
      const { data: siblingVals } = await supabase
        .from('document_value')
        .select('field_id, value_text')
        .in('document_id', siblingIds)
        .not('value_text', 'is', null)
      for (const sv of siblingVals ?? []) {
        if (sv.value_text && sv.value_text.trim() && !pooledValues[sv.field_id]) {
          pooledValues[sv.field_id] = sv.value_text
        }
      }
    }

    const docValueMap: Record<number, string> = {}
    for (const dv of docValues ?? []) {
      if (dv.value_text) {
        docValueMap[dv.field_id] = dv.value_text
      }
    }

    const merged: FieldValue[] = fieldDefs.map((f: any) => {
      const change = changeMap.get(f.field_id)
      return {
        field_id: f.field_id,
        field_name: f.field_name,
        value_text: docValueMap[f.field_id] ?? pooledValues[f.field_id] ?? '',
        display_order: f.display_order ?? 9999,
        data_kind: f.data_kind ?? '',
        previous_value: change?.previous_value ?? null,
        changed_at: change?.changed_at ?? null,
        changed_by: change?.changed_by ?? null,
      }
    })

    const fieldsToShow = hasMappings
      ? merged
      : merged.filter((f) => f.value_text.trim() !== '')

    const orderMap = new Map(customOrder.map((name: string, idx: number) => [name, idx]))
    fieldsToShow.sort((a, b) => {
      const [ag, ai] = fieldSortKey(a, orderMap)
      const [bg, bi] = fieldSortKey(b, orderMap)
      if (ag !== bg) return ag - bg
      return ai - bi
    })

    setFields(fieldsToShow)
    setLoading(false)
  }, [documentId, tagId, projectId])

  useEffect(() => {
    loadFields()
  }, [loadFields])

  const handleChange = (fieldId: number, value: string) => {
    const f = fields.find(field => field.field_id === fieldId)
    const originalDisplay = f
      ? (isNoteField(f) ? f.value_text : displayValue(f.field_name, f.value_text))
      : ''
    if (value === originalDisplay) {
      setEditedValues(prev => {
        const next = { ...prev }
        delete next[fieldId]
        return next
      })
    } else {
      setEditedValues(prev => ({ ...prev, [fieldId]: value }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')

    const fieldIds = Object.keys(editedValues).map(Number)

    // 저장 전 현재 값 스냅샷 (변경 감지용)
    const { data: prevValues } = await supabase
      .from('document_value')
      .select('field_id, value_text')
      .eq('document_id', documentId)
      .in('field_id', fieldIds)
    const prevMap: Record<number, string> = {}
    for (const pv of prevValues ?? []) {
      prevMap[pv.field_id] = pv.value_text ?? ''
    }

    const updates = fieldIds.map(fieldId => ({
      document_id: documentId,
      field_id: fieldId,
      value_text: editedValues[fieldId],
    }))

    const { error } = await supabase
      .from('document_value')
      .upsert(updates, { onConflict: 'document_id,field_id' })

    if (error) {
      setMessage(`Error: ${error.message}`)
      setSaving(false)
      return
    }

    // 자동 Minor Revision 처리
    const actualChanges = fieldIds
      .map(fid => ({
        field_id: fid,
        field_name: fields.find(f => f.field_id === fid)?.field_name ?? '',
        previous_value: prevMap[fid] ?? null,
        new_value: editedValues[fid],
      }))
      .filter(c => c.previous_value !== c.new_value)

    if (actualChanges.length > 0) {
      const newMinor = nextMinorRevision(currentMinorRevision)
      const displayRev = currentRevisionDisplay(currentRevNumber, newMinor)
      const committedBy = currentUser?.email ?? null

      // document.minor_revision 업데이트
      await supabase
        .from('document')
        .update({ minor_revision: newMinor })
        .eq('document_id', documentId)

      // document_revision 삽입 (committed_at도 함께 조회 — dvc timestamp 동기화용)
      const { data: revData } = await supabase
        .from('document_revision')
        .insert({
          document_id: documentId,
          revision_number: displayRev,
          revision_type: 'minor',
          note: null,
          committed_by: committedBy,
        })
        .select('revision_id, committed_at')
        .single()

      const revisionId = (revData as any)?.revision_id as number | null
      // DB가 부여한 committed_at을 dvc changed_at에 맞춤 → 타임스탬프 필터 정합성 보장
      const revCommittedAt = (revData as any)?.committed_at as string | null ?? new Date().toISOString()

      if (revisionId) {
        // document_revision_detail 삽입
        const details = actualChanges.map(c => ({
          revision_id: revisionId,
          document_number: currentDocNumber ?? '',
          tag_number: currentTagNumber,
          field_name: c.field_name,
          previous_value: c.previous_value,
          new_value: c.new_value,
          changed_at: revCommittedAt,
          changed_by: committedBy,
        }))
        await supabase.from('document_revision_detail').insert(details)
      }

      // DVC 누적 처리 (GUI 로직과 동일)
      // currentMinorRevision이 null이면 첫 번째 new minor →
      //   같은 document_number의 모든 sheet DVC 초기화 후 현재 변경만 insert
      // currentMinorRevision이 있으면 후속 minor → 기존 DVC 유지하며 누적 merge
      if (!currentMinorRevision) {
        // 첫 번째 minor: 같은 document_number의 모든 sheet DVC 전체 삭제
        let allSheetQuery = supabase
          .from('document')
          .select('document_id')
          .eq('document_number', currentDocNumber ?? '')
        if (projectId != null) allSheetQuery = allSheetQuery.eq('project_id', projectId)
        const { data: allSheetDocs } = await allSheetQuery
        const allSheetIds = (allSheetDocs ?? []).map((d: any) => d.document_id as number)
        if (allSheetIds.length > 0) {
          await supabase.from('document_value_change').delete().in('document_id', allSheetIds)
        }
        const dvcInserts = actualChanges.map(c => ({
          document_id: documentId,
          field_id: c.field_id,
          field_name: c.field_name,
          previous_value: c.previous_value,
          new_value: c.new_value,
          tag_number: currentTagNumber,
          changed_at: revCommittedAt,
          changed_by: committedBy,
        }))
        if (dvcInserts.length > 0) {
          await supabase
            .from('document_value_change')
            .upsert(dvcInserts, { onConflict: 'document_id,field_id' })
        }
      } else {
        // 후속 minor: 기존 DVC 조회 후 누적 merge
        const { data: existingDvc } = await supabase
          .from('document_value_change')
          .select('field_id, previous_value, new_value')
          .eq('document_id', documentId)
        const existingDvcMap = new Map((existingDvc ?? []).map((e: any) => [e.field_id as number, e]))

        const dvcUpserts = actualChanges.map(c => {
          const existing = existingDvcMap.get(c.field_id)
          return {
            document_id: documentId,
            field_id: c.field_id,
            field_name: c.field_name,
            // 기존 DVC가 있으면 original previous_value 유지 (baseline 보존)
            previous_value: existing ? existing.previous_value : c.previous_value,
            new_value: c.new_value,
            tag_number: currentTagNumber,
            changed_at: revCommittedAt,
            changed_by: committedBy,
          }
        })

        // baseline으로 복귀된 필드 삭제 (previous_value === new_value)
        const revertedFieldIds = dvcUpserts
          .filter(d => d.previous_value === d.new_value)
          .map(d => d.field_id)
        const toUpsert = dvcUpserts.filter(d => d.previous_value !== d.new_value)

        for (const fid of revertedFieldIds) {
          await supabase.from('document_value_change').delete()
            .eq('document_id', documentId).eq('field_id', fid)
        }
        if (toUpsert.length > 0) {
          await supabase
            .from('document_value_change')
            .upsert(toUpsert, { onConflict: 'document_id,field_id' })
        }
      }
    }

    // refresh_browser_mv is a no-op shim in the unified schema
    setMessage('저장 완료 — Minor Revision 자동 커밋')
    setEditedValues({})
    await loadFields()
    setSaving(false)
    setTimeout(() => setMessage(''), 4000)
  }

  const moveField = (index: number, direction: 'up' | 'down' | 'top' | 'bottom') => {
    const newFields = [...fields]
    const [item] = newFields.splice(index, 1)
    if (direction === 'up' && index > 0) {
      newFields.splice(index - 1, 0, item)
    } else if (direction === 'down' && index < fields.length - 1) {
      newFields.splice(index + 1, 0, item)
    } else if (direction === 'top') {
      newFields.unshift(item)
    } else if (direction === 'bottom') {
      newFields.push(item)
    } else {
      newFields.splice(index, 0, item)
    }
    newFields.forEach((f, i) => (f.display_order = i + 1))
    setFields(newFields)
  }

  const saveOrder = async () => {
    setSaving(true)
    setMessage('')
    const updates = fields.map((f, i) => ({ field_id: f.field_id, display_order: i + 1 }))
    for (let i = 0; i < updates.length; i += 50) {
      const chunk = updates.slice(i, i + 50)
      for (const u of chunk) {
        await supabase
          .from('field_def')
          .update({ display_order: u.display_order })
          .eq('field_id', u.field_id)
      }
    }
    setMessage('Field order saved')
    setReorderMode(false)
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const openCommitModal = async () => {
    setCommitRevNumber('')
    setCommitNote('')
    setCommitRevDesc('ISSUED FOR REVIEW')
    setShowCommitModal(true)

    // 이 tag의 document_number 목록 조회
    const { data: tagDocs } = await supabase
      .from('document')
      .select('document_number')
      .eq('tag_id', tagId)
    const docNums = [...new Set((tagDocs ?? []).map((d: any) => d.document_number as string))].sort()
    setAvailableDocNumbers(docNums)

    const defaultDoc = currentDocNumber ?? docNums[0] ?? ''
    setSelectedDocNumber(defaultDoc)
    if (defaultDoc) await loadTargetSheets(defaultDoc)
  }

  const loadTargetSheets = async (docNumber: string) => {
    let q = supabase
      .from('document')
      .select('sheet_number, revision_number, minor_revision')
      .eq('document_number', docNumber)
    if (projectId != null) q = q.eq('project_id', projectId)
    const { data } = await q.order('sheet_number')
    const sheets = (data ?? []).map((d: any) => ({
      sheet: String(d.sheet_number ?? '').padStart(3, '0'),
      rev: currentRevisionDisplay(d.revision_number, d.minor_revision),
    }))
    setTargetSheets(sheets)
  }

  const handleCommitRevision = async () => {
    if (!commitRevNumber.trim() || !selectedDocNumber) return
    setCommitting(true)
    try {
      const committedBy = currentUser?.email ?? null

      // 대상 document_id 목록
      let targetQuery = supabase
        .from('document')
        .select('document_id, document_number')
        .eq('document_number', selectedDocNumber)
      if (projectId != null) targetQuery = targetQuery.eq('project_id', projectId)
      const { data: targetDocs } = await targetQuery

      for (const td of targetDocs ?? []) {
        const t_did = td.document_id as number

        // [A] 이전 major revision committed_at 조회 (INSERT 전)
        const { data: prevMajorResult } = await supabase
          .from('document_revision')
          .select('committed_at')
          .eq('document_id', t_did)
          .eq('revision_type', 'major')
          .order('committed_at', { ascending: false })
          .limit(1).maybeSingle()
        const prevMajorCommittedAt = (prevMajorResult as any)?.committed_at ?? null

        // [B] 새 major revision INSERT → revision_id, committed_at 획득
        const { data: revData } = await supabase
          .from('document_revision')
          .insert({
            document_id: t_did,
            revision_number: commitRevNumber.trim(),
            revision_type: 'major',
            note: commitNote.trim() || null,
            committed_by: committedBy,
          })
          .select('revision_id, committed_at')
          .single()
        const revId = (revData as any)?.revision_id as number | null
        const majorCommittedAt = (revData as any)?.committed_at as string ?? new Date().toISOString()

        // [C] 구간 내 minor revision IDs 조회
        let minorRevQuery = supabase
          .from('document_revision')
          .select('revision_id')
          .eq('document_id', t_did)
          .eq('revision_type', 'minor')
          .lt('committed_at', majorCommittedAt)
          .order('committed_at', { ascending: true })
        if (prevMajorCommittedAt) minorRevQuery = minorRevQuery.gt('committed_at', prevMajorCommittedAt)
        const { data: minorRevs } = await minorRevQuery
        const minorRevIds = (minorRevs ?? []).map((r: any) => r.revision_id as number)

        // [D] minor revision detail 조회 → 필드별 누적 변경 계산
        let cumulativeChanges: { field_name: string; prev: string | null; newVal: string | null }[] = []
        if (minorRevIds.length > 0) {
          const { data: minorDetails } = await supabase
            .from('document_revision_detail')
            .select('field_name, previous_value, new_value, revision_id')
            .in('revision_id', minorRevIds)
          const sorted = (minorDetails ?? []).sort((a: any, b: any) => a.revision_id - b.revision_id)
          const fieldFirstPrev = new Map<string, string | null>()
          const fieldLastNew = new Map<string, string | null>()
          for (const d of sorted) {
            if (!fieldFirstPrev.has(d.field_name)) fieldFirstPrev.set(d.field_name, d.previous_value)
            fieldLastNew.set(d.field_name, d.new_value)
          }
          for (const [fieldName, firstPrev] of fieldFirstPrev) {
            const lastNew = fieldLastNew.get(fieldName)
            if (firstPrev !== lastNew) cumulativeChanges.push({ field_name: fieldName, prev: firstPrev, newVal: lastNew ?? null })
          }
        }

        // [E] document_revision_detail INSERT (누적 변경사항)
        if (revId && cumulativeChanges.length > 0) {
          await supabase.from('document_revision_detail').insert(
            cumulativeChanges.map(c => ({
              revision_id: revId,
              document_number: td.document_number ?? '',
              tag_number: currentTagNumber,
              field_name: c.field_name,
              previous_value: c.prev,
              new_value: c.newVal,
              changed_at: majorCommittedAt,
              changed_by: committedBy,
            }))
          )
        }

        // [F] document 업데이트: revision_number = 새값, minor_revision = null
        await supabase
          .from('document')
          .update({ revision_number: commitRevNumber.trim(), minor_revision: null })
          .eq('document_id', t_did)

        // [G] dvc DELETE 후 누적 변경사항 INSERT
        await supabase.from('document_value_change').delete().eq('document_id', t_did)
        if (cumulativeChanges.length > 0) {
          const fieldNames = cumulativeChanges.map(c => c.field_name)
          let fieldDefQuery = supabase
            .from('field_def')
            .select('field_id, field_name')
            .in('field_name', fieldNames)
          if (projectId != null) fieldDefQuery = fieldDefQuery.eq('project_id', projectId)
          const { data: fieldDefs } = await fieldDefQuery
          const nameToId = new Map((fieldDefs ?? []).map((f: any) => [f.field_name as string, f.field_id as number]))
          const dvcInserts = cumulativeChanges
            .filter(c => nameToId.has(c.field_name))
            .map(c => ({
              document_id: t_did,
              field_id: nameToId.get(c.field_name),
              field_name: c.field_name,
              previous_value: c.prev,
              new_value: c.newVal,
              tag_number: currentTagNumber,
              changed_at: majorCommittedAt,
              changed_by: committedBy,
            }))
          if (dvcInserts.length > 0)
            await supabase.from('document_value_change').upsert(dvcInserts, { onConflict: 'document_id,field_id' })
        }

        // [G.5] Revision Description field value 저장 (모든 sheet에 적용)
        if (commitRevDesc) {
          let revDescQuery = supabase
            .from('field_def')
            .select('field_id')
            .ilike('field_name', 'revision description')
          if (projectId != null) revDescQuery = revDescQuery.eq('project_id', projectId)
          const { data: revDescField } = await revDescQuery.maybeSingle()
          const revDescFieldId = (revDescField as any)?.field_id as number | null
          if (revDescFieldId) {
            await supabase.from('document_value').upsert(
              { document_id: t_did, field_id: revDescFieldId, value_text: commitRevDesc },
              { onConflict: 'document_id,field_id' }
            )
          }
        }
      }

      setShowCommitModal(false)
      setMessage(`Major Revision ${commitRevNumber.trim()} 커밋 완료 (${(targetDocs ?? []).length}개 sheet)`)
      await loadFields()
      onRevisionCommit?.()
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
    setCommitting(false)
    setTimeout(() => setMessage(''), 5000)
  }

  const loadRevisionHistory = async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('document_revision')
      .select('*')
      .eq('document_id', documentId)
      .order('committed_at', { ascending: false })
    setRevisions((data ?? []).map(r => ({ ...(r as DocumentRevision), expanded: false })))
    setLoadingHistory(false)
  }

  const toggleHistoryPanel = async () => {
    if (!showHistoryPanel) {
      await loadRevisionHistory()
    }
    setShowHistoryPanel(prev => !prev)
  }

  const toggleRevisionDetail = async (revisionId: number) => {
    setRevisions(prev => prev.map(r => {
      if (r.revision_id !== revisionId) return r
      if (r.details) return { ...r, expanded: !r.expanded }
      return r
    }))

    const rev = revisions.find(r => r.revision_id === revisionId)
    if (rev && !rev.details) {
      const { data } = await supabase
        .from('document_revision_detail')
        .select('*')
        .eq('revision_id', revisionId)
        .order('field_name')
      setRevisions(prev => prev.map(r =>
        r.revision_id === revisionId
          ? { ...r, details: (data ?? []) as DocumentRevisionDetail[], expanded: true }
          : r
      ))
    }
  }

  const exportRevisionCSV = async () => {
    const { data: allRevisions } = await supabase
      .from('document_revision')
      .select('*')
      .eq('document_id', documentId)
      .order('committed_at', { ascending: false })

    if (!allRevisions || allRevisions.length === 0) return

    const revIds = allRevisions.map((r: any) => r.revision_id)
    const { data: allDetails } = await supabase
      .from('document_revision_detail')
      .select('*')
      .in('revision_id', revIds)
      .order('field_name')

    const detailMap = new Map<number, any[]>()
    for (const d of allDetails ?? []) {
      if (!detailMap.has(d.revision_id)) detailMap.set(d.revision_id, [])
      detailMap.get(d.revision_id)!.push(d)
    }

    const headers = ['Committed At', 'Type', 'Rev No.', 'Note', 'By', 'Field Name', 'Tag Number', 'Previous Value', 'New Value', 'Changed At', 'Changed By']
    const csvRows: string[] = [headers.join(',')]
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`

    for (const rev of allRevisions) {
      const details = detailMap.get(rev.revision_id) ?? []
      const baseRow = [
        q(new Date(rev.committed_at).toLocaleString()),
        q(rev.revision_type ?? ''),
        q(rev.revision_number ?? ''),
        q(rev.note ?? ''),
        q(rev.committed_by ?? ''),
      ]
      if (details.length === 0) {
        csvRows.push([...baseRow, q(''), q(''), q(''), q(''), q(''), q('')].join(','))
      } else {
        for (const d of details) {
          csvRows.push([
            ...baseRow,
            q(d.field_name ?? ''),
            q(d.tag_number ?? ''),
            q(d.previous_value ?? ''),
            q(d.new_value ?? ''),
            q(d.changed_at ? new Date(d.changed_at).toLocaleString() : ''),
            q(d.changed_by ?? ''),
          ].join(','))
        }
      }
    }

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `revision_history_${documentId}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleRollback = async (target: RevisionWithDetails) => {
    setRollingBack(true)
    setMessage('')

    try {
      const { data: laterRevisions } = await supabase
        .from('document_revision')
        .select('revision_id, committed_at')
        .eq('document_id', documentId)
        .gt('committed_at', target.committed_at)
        .order('committed_at', { ascending: true })

      if (!laterRevisions || laterRevisions.length === 0) {
        setMessage('이미 최신 revision입니다. 롤백할 내용이 없습니다.')
        setRollingBack(false)
        setRollbackTarget(null)
        return
      }

      const laterRevIds = laterRevisions.map((r: any) => r.revision_id)
      const { data: laterDetails } = await supabase
        .from('document_revision_detail')
        .select('*')
        .in('revision_id', laterRevIds)

      const revCommitMap = new Map(laterRevisions.map((r: any) => [r.revision_id, r.committed_at as string]))
      const sortedDetails = (laterDetails ?? []).sort((a: any, b: any) => {
        const atA = revCommitMap.get(a.revision_id) ?? ''
        const atB = revCommitMap.get(b.revision_id) ?? ''
        return atA.localeCompare(atB)
      })

      const fieldRestoreValues = new Map<string, string | null>()
      for (const detail of sortedDetails) {
        if (!fieldRestoreValues.has(detail.field_name)) {
          fieldRestoreValues.set(detail.field_name, detail.previous_value)
        }
      }

      const fieldNames = Array.from(fieldRestoreValues.keys())
      let rollbackFdQuery = supabase
        .from('field_def')
        .select('field_id, field_name')
        .in('field_name', fieldNames)
      if (projectId != null) rollbackFdQuery = rollbackFdQuery.eq('project_id', projectId)
      const { data: fieldDefs } = await rollbackFdQuery

      const nameToId = new Map((fieldDefs ?? []).map((f: any) => [f.field_name as string, f.field_id as number]))

      const upserts: { document_id: number; field_id: number; value_text: string }[] = []
      for (const [fieldName, prevValue] of fieldRestoreValues) {
        const fieldId = nameToId.get(fieldName)
        if (fieldId !== undefined) {
          upserts.push({ document_id: documentId, field_id: fieldId, value_text: prevValue ?? '' })
        }
      }

      if (upserts.length > 0) {
        const { error: upsertError } = await supabase
          .from('document_value')
          .upsert(upserts, { onConflict: 'document_id,field_id' })
        if (upsertError) throw upsertError
      }

      await supabase.from('document_value_change').delete().eq('document_id', documentId)

      let newRevNumber: string | null = null
      let newMinorRevision: string | null = null

      if (target.revision_type === 'major') {
        newRevNumber = target.revision_number
        newMinorRevision = null
      } else {
        const { data: priorMajor } = await supabase
          .from('document_revision')
          .select('revision_number')
          .eq('document_id', documentId)
          .eq('revision_type', 'major')
          .lte('committed_at', target.committed_at)
          .order('committed_at', { ascending: false })
          .limit(1)

        if (priorMajor && priorMajor.length > 0) {
          const majorPart = priorMajor[0].revision_number as string
          newRevNumber = majorPart
          const fullRev = target.revision_number ?? ''
          newMinorRevision = fullRev.startsWith(majorPart) ? (fullRev.slice(majorPart.length) || null) : null
        } else {
          newRevNumber = target.revision_number
          newMinorRevision = null
        }
      }

      await supabase
        .from('document')
        .update({ revision_number: newRevNumber, minor_revision: newMinorRevision })
        .eq('document_id', documentId)

      await supabase.from('document_revision_detail').delete().in('revision_id', laterRevIds)
      await supabase.from('document_revision').delete().in('revision_id', laterRevIds)

      // refresh_browser_mv is a no-op shim in the unified schema
      setMessage(`Revision ${target.revision_number} 으로 롤백 완료 (${upserts.length}개 필드 복원, ${laterRevIds.length}개 이후 revision 삭제)`)
      setRollbackTarget(null)
      await loadRevisionHistory()
      await loadFields()
    } catch (err) {
      setMessage(`Rollback 오류: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }

    setRollingBack(false)
    setTimeout(() => setMessage(''), 6000)
  }

  const hasChanges = Object.keys(editedValues).length > 0
  const displayRev = currentRevisionDisplay(currentRevNumber, currentMinorRevision)

  if (loading) {
    return <div className="text-gray-500 py-4">Loading field values...</div>
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(currentRevNumber || currentMinorRevision) && (
          <>
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5 bg-gray-50">
              Rev: <span className="font-mono font-semibold">{displayRev || '-'}</span>
            </span>
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5 bg-gray-50">
              Major: <span className="font-mono font-semibold">{currentRevNumber || '-'}</span>
            </span>
            <span className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5 bg-gray-50">
              Minor: <span className="font-mono font-semibold">{currentMinorRevision || '-'}</span>
            </span>
          </>
        )}
        {canEdit && (
          <button
            onClick={() => setReorderMode(!reorderMode)}
            className={`px-3 py-1 text-xs rounded border ${
              reorderMode
                ? 'bg-orange-50 border-orange-300 text-orange-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {reorderMode ? 'Cancel Reorder' : 'Reorder Fields'}
          </button>
        )}
        {reorderMode && (
          <button
            onClick={saveOrder}
            disabled={saving}
            className="px-3 py-1 text-xs rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Order'}
          </button>
        )}
        {!reorderMode && canEdit && (
          <button
            onClick={openCommitModal}
            className="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700"
          >
            Major Revision 커밋
          </button>
        )}
        {!reorderMode && (
          <button
            onClick={toggleHistoryPanel}
            className="px-3 py-1 text-xs rounded border border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100"
          >
            {showHistoryPanel ? 'Hide History' : 'Revision History'}
          </button>
        )}
      </div>

      {/* Revision History Panel */}
      {showHistoryPanel && (
        <div className="mb-4 border border-gray-200 rounded-lg bg-gray-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Revision History</h3>
            <button
              onClick={exportRevisionCSV}
              disabled={revisions.length === 0}
              className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
          {loadingHistory ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : revisions.length === 0 ? (
            <div className="text-sm text-gray-500">No revisions committed yet.</div>
          ) : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-2 py-1 text-left border border-gray-200 w-4"></th>
                    <th className="px-2 py-1 text-left border border-gray-200">Committed At</th>
                    <th className="px-2 py-1 text-left border border-gray-200">Type</th>
                    <th className="px-2 py-1 text-left border border-gray-200">Rev No.</th>
                    <th className="px-2 py-1 text-left border border-gray-200">Note</th>
                    <th className="px-2 py-1 text-left border border-gray-200">By</th>
                    {isAdmin && <th className="px-2 py-1 text-left border border-gray-200">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {revisions.map(r => (
                    <>
                      <tr
                        key={r.revision_id}
                        className="border-b border-gray-100 cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleRevisionDetail(r.revision_id)}
                      >
                        <td className="px-2 py-1 border border-gray-200 text-gray-400">
                          {r.expanded ? '▾' : '▸'}
                        </td>
                        <td className="px-2 py-1 border border-gray-200 whitespace-nowrap">
                          {new Date(r.committed_at).toLocaleString()}
                        </td>
                        <td className="px-2 py-1 border border-gray-200 capitalize">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                            r.revision_type === 'major'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {r.revision_type}
                          </span>
                        </td>
                        <td className="px-2 py-1 border border-gray-200 font-mono font-semibold">{r.revision_number}</td>
                        <td className="px-2 py-1 border border-gray-200">{r.note ?? ''}</td>
                        <td className="px-2 py-1 border border-gray-200 whitespace-nowrap">{r.committed_by ?? ''}</td>
                        {isAdmin && (
                          <td className="px-2 py-1 border border-gray-200" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setRollbackTarget(r)}
                              className="px-2 py-0.5 text-[10px] rounded bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap"
                            >
                              Roll-back to here
                            </button>
                          </td>
                        )}
                      </tr>
                      {r.expanded && (
                        <tr key={`${r.revision_id}-detail`}>
                          <td colSpan={isAdmin ? 7 : 6} className="px-4 py-2 bg-blue-50 border border-blue-100">
                            {!r.details ? (
                              <span className="text-xs text-gray-400">Loading...</span>
                            ) : r.details.length === 0 ? (
                              <span className="text-xs text-gray-400">(변경 필드 내역 없음)</span>
                            ) : (
                              <div className="space-y-1">
                                {r.details.map(d => (
                                  <div key={d.detail_id} className="text-xs text-gray-700">
                                    <span className="font-medium text-gray-900">{d.field_name}</span>
                                    {d.tag_number && (
                                      <span className="ml-1 text-gray-400">[{d.tag_number}]</span>
                                    )}
                                    {' '}
                                    <span className="text-red-500 line-through">&quot;{d.previous_value ?? ''}&quot;</span>
                                    {' → '}
                                    <span className="text-green-600">&quot;{d.new_value ?? ''}&quot;</span>
                                    <span className="ml-2 text-gray-400 text-[10px]">
                                      {d.changed_at ? new Date(d.changed_at).toLocaleString() : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {fields.length === 0 ? (
        <p className="text-gray-500">No field values found for this document.</p>
      ) : (
        <div className="space-y-1">
          {fields.map((f, idx) => {
            const isChanged = f.changed_at !== null
            return (
              <div key={f.field_id} className={`flex gap-2 ${isNoteField(f) ? 'items-start' : 'items-center'}`}>
                {/* Reorder buttons */}
                {reorderMode && (
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => moveField(idx, 'top')} disabled={idx === 0}
                      className="px-1 py-0.5 text-[10px] text-gray-500 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-30 rounded" title="Move to top">⏫</button>
                    <button onClick={() => moveField(idx, 'up')} disabled={idx === 0}
                      className="px-1 py-0.5 text-[10px] text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 rounded" title="Move up">▲</button>
                    <button onClick={() => moveField(idx, 'down')} disabled={idx === fields.length - 1}
                      className="px-1 py-0.5 text-[10px] text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 rounded" title="Move down">▼</button>
                    <button onClick={() => moveField(idx, 'bottom')} disabled={idx === fields.length - 1}
                      className="px-1 py-0.5 text-[10px] text-gray-500 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-30 rounded" title="Move to bottom">⏬</button>
                  </div>
                )}
                {reorderMode && (
                  <span className="w-6 text-xs text-gray-400 text-right">{idx + 1}</span>
                )}
                <label className="w-64 text-sm font-medium text-gray-700 truncate shrink-0 pt-1" title={f.field_name}>
                  {f.field_name}
                  {isChanged && !reorderMode && (
                    <span className="ml-1 text-yellow-600 text-[10px] font-normal">(changed)</span>
                  )}
                </label>
                <div className="flex-1 flex flex-col gap-0.5">
                  {canEdit && !reorderMode ? (
                    isNoteField(f) ? (
                      <textarea
                        rows={15}
                        value={editedValues[f.field_id] ?? f.value_text}
                        onChange={(e) => handleChange(f.field_id, e.target.value)}
                        className={`flex-1 w-full px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical ${
                          f.field_id in editedValues
                            ? 'border-yellow-300 bg-yellow-100'
                            : isChanged
                            ? 'border-yellow-400 bg-yellow-50'
                            : 'border-gray-300'
                        }`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={editedValues[f.field_id] ?? displayValue(f.field_name, f.value_text)}
                        onChange={(e) => handleChange(f.field_id, e.target.value)}
                        className={`flex-1 w-full px-3 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          f.field_id in editedValues
                            ? 'border-yellow-300 bg-yellow-100'
                            : isChanged
                            ? 'border-yellow-400 bg-yellow-50'
                            : 'border-gray-300'
                        }`}
                      />
                    )
                  ) : (
                    isNoteField(f) ? (
                      <span className={`flex-1 text-sm text-gray-800 whitespace-pre-wrap ${isChanged && !reorderMode ? 'bg-yellow-50 border border-yellow-400 rounded px-2 py-1' : ''}`}>
                        {f.value_text}
                      </span>
                    ) : (
                      <span className={`flex-1 text-sm text-gray-800 ${isChanged && !reorderMode ? 'bg-yellow-50 border border-yellow-400 rounded px-2 py-0.5' : ''}`}>
                        {displayValue(f.field_name, f.value_text)}
                      </span>
                    )
                  )}
                  {isChanged && !reorderMode && (
                    <span className="text-[11px] text-yellow-700 italic">
                      이전: &quot;{f.previous_value ?? '(빈값)'}&quot;
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canEdit && !reorderMode && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {saving ? 'Saving...' : `Save Changes (${Object.keys(editedValues).length})`}
          </button>
          {message && (
            <span className={`text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </span>
          )}
        </div>
      )}

      {reorderMode && message && (
        <div className="mt-3">
          <span className={`text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </span>
        </div>
      )}

      {/* Major Revision Commit Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-semibold mb-4">Major Revision 커밋</h2>

            {/* Document Number 선택 */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Document Number</label>
              <select
                value={selectedDocNumber}
                onChange={async e => {
                  setSelectedDocNumber(e.target.value)
                  await loadTargetSheets(e.target.value)
                }}
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {availableDocNumbers.map(dn => (
                  <option key={dn} value={dn}>{dn}</option>
                ))}
              </select>
            </div>

            {/* 대상 sheet 미리보기 */}
            {targetSheets.length > 0 && (
              <div className="mb-3 bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-600">
                <span className="font-medium">대상 sheet ({targetSheets.length}개):</span>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {targetSheets.map(s => (
                    <li key={s.sheet}>· Sheet {s.sheet} [현재 Rev: <span className="font-mono">{s.rev || '-'}</span>]</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 새 Revision 번호 */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">새 Major Revision 번호</label>
              <input
                type="text"
                value={commitRevNumber}
                onChange={e => setCommitRevNumber(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="예: B, C, 2..."
              />
            </div>

            {/* Revision Description */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Revision Description <span className="text-red-500">*</span>
              </label>
              <select
                value={commitRevDesc}
                onChange={e => setCommitRevDesc(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option>ISSUED FOR REVIEW</option>
                <option>ISSUED FOR CONSTRUCTION</option>
                <option>AS-BUILT</option>
              </select>
            </div>

            {/* Note */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
              <textarea
                rows={3}
                value={commitNote}
                onChange={e => setCommitNote(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                placeholder="Optional note..."
              />
            </div>

            <p className="text-xs text-orange-600 mb-4">
              ⚠ 커밋 후 대상 sheet 모두의 minor revision이 초기화됩니다.
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCommitModal(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={handleCommitRevision}
                disabled={committing || !commitRevNumber.trim() || !selectedDocNumber || !commitRevDesc}
                className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
              >
                {committing ? 'Committing...' : '커밋'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      {rollbackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-3 text-red-700">Roll-back 확인</h2>
            <p className="text-sm text-gray-700 mb-2">
              아래 revision 시점으로 롤백하시겠습니까?
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-3 text-xs space-y-1">
              <div><span className="font-medium">Rev No.:</span> <span className="font-mono font-bold">{rollbackTarget.revision_number}</span></div>
              <div><span className="font-medium">Type:</span> {rollbackTarget.revision_type}</div>
              <div><span className="font-medium">Committed At:</span> {new Date(rollbackTarget.committed_at).toLocaleString()}</div>
              {rollbackTarget.note && <div><span className="font-medium">Note:</span> {rollbackTarget.note}</div>}
            </div>
            <p className="text-xs text-red-600 mb-4">
              ⚠ 이 시점 이후의 모든 revision 이력이 영구적으로 삭제되고, 필드 값이 해당 시점으로 복원됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRollbackTarget(null)}
                disabled={rollingBack}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={() => handleRollback(rollbackTarget)}
                disabled={rollingBack}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {rollingBack ? 'Rolling back...' : '롤백 실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
