'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-client'

interface TemplateRow {
  template_code: string
  description: string | null
}

interface InstrumentTypeRow {
  instrument_type: string
  n: number
}

type MatchKind = 'prefix' | 'regex'

interface SavedRule {
  rule_id: number
  template_code: string
  match_kind: MatchKind
  match_value: string
  priority: number
  is_active: boolean
}

interface DraftRule {
  draftId: string
  rule_id?: number
  template_code: string
  match_kind: MatchKind
  match_value: string
  priority: number
  is_active: boolean
  _deleted?: boolean
  _dirty?: boolean
}

interface Props {
  projectId: number
  templates: TemplateRow[]
  instrumentTypes: InstrumentTypeRow[]
}

const UNCLASSIFIED = '__unclassified__'

function fromSaved(r: SavedRule): DraftRule {
  return {
    draftId: `s:${r.rule_id}`,
    rule_id: r.rule_id,
    template_code: r.template_code,
    match_kind: r.match_kind,
    match_value: r.match_value,
    priority: r.priority,
    is_active: r.is_active,
  }
}

function newDraft(template: string, priority: number): DraftRule {
  return {
    draftId: `n:${Math.random().toString(36).slice(2, 10)}`,
    template_code: template,
    match_kind: 'prefix',
    match_value: '',
    priority,
    is_active: true,
    _dirty: true,
  }
}

// Apply the rule list to an instrument_type, returning the matched template or null.
function classify(instrumentType: string, rules: DraftRule[]): string | null {
  const active = rules
    .filter((r) => !r._deleted && r.is_active && r.match_value.trim() !== '')
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.match_value.length - a.match_value.length
    })
  for (const r of active) {
    try {
      if (r.match_kind === 'prefix') {
        if (instrumentType.startsWith(r.match_value)) return r.template_code
      } else {
        if (new RegExp(r.match_value).test(instrumentType)) return r.template_code
      }
    } catch {
      // bad regex, skip silently in preview; save validation will catch it
    }
  }
  return null
}

export default function ClassificationEditor({ projectId, templates, instrumentTypes }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [drafts, setDrafts] = useState<DraftRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [previewFilter, setPreviewFilter] = useState<string>('all')
  const [previewSearch, setPreviewSearch] = useState('')

  useEffect(() => { void loadRules() }, [projectId])

  async function loadRules() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .schema('drawings')
      .from('iis_classification_rule')
      .select('rule_id, template_code, match_kind, match_value, priority, is_active')
      .eq('project_id', projectId)
      .order('priority')
      .order('match_value')
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setDrafts((data ?? []).map(fromSaved))
    setLoading(false)
  }

  const sortedDrafts = useMemo(() => {
    const visible = drafts.filter((d) => !d._deleted)
    visible.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.template_code !== b.template_code) return a.template_code.localeCompare(b.template_code)
      return a.match_value.localeCompare(b.match_value)
    })
    return visible
  }, [drafts])

  const hasPendingChanges = useMemo(
    () => drafts.some((d) => d._dirty || d._deleted),
    [drafts],
  )

  // Live classification preview from instrumentTypes + current draft rules.
  const classification = useMemo(() => {
    const byTemplate: Record<string, { tags: number; types: number }> = {}
    const rowResults: { type: string; n: number; template: string | null }[] = []
    for (const it of instrumentTypes) {
      const tpl = classify(it.instrument_type, drafts)
      const key = tpl ?? UNCLASSIFIED
      byTemplate[key] = byTemplate[key] || { tags: 0, types: 0 }
      byTemplate[key].tags += it.n
      byTemplate[key].types += 1
      rowResults.push({ type: it.instrument_type, n: it.n, template: tpl })
    }
    return { byTemplate, rowResults }
  }, [drafts, instrumentTypes])

  const filteredPreview = useMemo(() => {
    const q = previewSearch.trim().toLowerCase()
    return classification.rowResults
      .filter((r) => {
        if (previewFilter === 'all') return true
        if (previewFilter === UNCLASSIFIED) return r.template === null
        return r.template === previewFilter
      })
      .filter((r) => q === '' || r.type.toLowerCase().includes(q))
  }, [classification.rowResults, previewFilter, previewSearch])

  function updateDraft(draftId: string, patch: Partial<DraftRule>) {
    setDrafts((arr) =>
      arr.map((d) => (d.draftId === draftId ? { ...d, ...patch, _dirty: true } : d)),
    )
  }
  function deleteDraft(draftId: string) {
    setDrafts((arr) =>
      arr
        .map((d) => {
          if (d.draftId !== draftId) return d
          if (d.rule_id == null) return null
          return { ...d, _deleted: true }
        })
        .filter((d): d is DraftRule => d != null),
    )
  }
  function addDraft() {
    const tpl = templates[0]?.template_code ?? ''
    const nextPriority = Math.max(100, ...drafts.filter((d) => !d._deleted).map((d) => d.priority)) + 10
    setDrafts((arr) => [...arr, newDraft(tpl, nextPriority)])
  }

  async function save() {
    setSaving(true)
    setError(null)
    setInfo(null)
    try {
      const inserts = drafts.filter((d) => !d._deleted && d.rule_id == null && d._dirty)
      const updates = drafts.filter((d) => !d._deleted && d.rule_id != null && d._dirty)
      const deletes = drafts.filter((d) => d._deleted && d.rule_id != null)

      for (const d of deletes) {
        const { error } = await supabase
          .schema('drawings')
          .from('iis_classification_rule')
          .delete()
          .eq('rule_id', d.rule_id!)
        if (error) throw error
      }
      for (const d of updates) {
        if (!d.match_value.trim()) throw new Error(`Empty match_value for rule_id ${d.rule_id}`)
        const { error } = await supabase
          .schema('drawings')
          .from('iis_classification_rule')
          .update({
            template_code: d.template_code,
            match_kind: d.match_kind,
            match_value: d.match_value,
            priority: d.priority,
            is_active: d.is_active,
          })
          .eq('rule_id', d.rule_id!)
        if (error) throw error
      }
      if (inserts.length > 0) {
        const payload = inserts.map((d) => {
          if (!d.match_value.trim()) {
            throw new Error('Cannot save rule with empty match_value')
          }
          return {
            project_id: projectId,
            template_code: d.template_code,
            match_kind: d.match_kind,
            match_value: d.match_value,
            priority: d.priority,
            is_active: d.is_active,
          }
        })
        const { error } = await supabase
          .schema('drawings')
          .from('iis_classification_rule')
          .insert(payload)
        if (error) throw error
      }
      setInfo(`Saved (${inserts.length} new, ${updates.length} updated, ${deletes.length} deleted).`)
      await loadRules()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  function discardChanges() {
    void loadRules()
    setInfo(null)
    setError(null)
  }

  if (loading) return <div className="text-sm text-gray-500">Loading rules…</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT — Rules editor */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">Rules ({sortedDrafts.length})</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={addDraft}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50"
            >
              + Rule
            </button>
            <button
              onClick={discardChanges}
              disabled={!hasPendingChanges || saving}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={!hasPendingChanges || saving}
              className="px-3 py-1.5 text-sm bg-[#000080] text-white rounded hover:bg-[#000060] disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {error && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        {info && <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">{info}</div>}
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-2 py-2 text-left w-16">Prio</th>
                <th className="px-2 py-2 text-left w-20">Kind</th>
                <th className="px-2 py-2 text-left">Match value</th>
                <th className="px-2 py-2 text-left w-28">Template</th>
                <th className="px-2 py-2 text-center w-12">On</th>
                <th className="px-2 py-2 text-right w-12"></th>
              </tr>
            </thead>
            <tbody>
              {sortedDrafts.map((d) => (
                <tr
                  key={d.draftId}
                  className={`border-t border-gray-100 ${d._dirty ? 'bg-yellow-50' : ''}`}
                >
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={d.priority}
                      onChange={(e) => updateDraft(d.draftId, { priority: parseInt(e.target.value || '0', 10) })}
                      className="w-14 px-1.5 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={d.match_kind}
                      onChange={(e) => updateDraft(d.draftId, { match_kind: e.target.value as MatchKind })}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-sm"
                    >
                      <option value="prefix">prefix</option>
                      <option value="regex">regex</option>
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      value={d.match_value}
                      onChange={(e) => updateDraft(d.draftId, { match_value: e.target.value })}
                      placeholder={d.match_kind === 'prefix' ? 'PRESSURE …' : '^[A-Z]+-\\d+'}
                      className="w-full px-2 py-1 border border-gray-200 rounded font-mono text-sm"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={d.template_code}
                      onChange={(e) => updateDraft(d.draftId, { template_code: e.target.value })}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-sm"
                    >
                      {templates.map((t) => (
                        <option key={t.template_code} value={t.template_code}>
                          {t.template_code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={d.is_active}
                      onChange={(e) => updateDraft(d.draftId, { is_active: e.target.checked })}
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      onClick={() => deleteDraft(d.draftId)}
                      className="text-gray-400 hover:text-red-600 text-sm"
                      title="Delete"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {sortedDrafts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-gray-400 text-sm">
                    No rules yet. Click + Rule to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          prefix는 instrument_type 의 시작 부분, regex는 instrument_type 전체에 적용됩니다. 같은 priority 면 더 긴 match_value 가 먼저 적용됩니다.
        </p>
      </section>

      {/* RIGHT — Live preview */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">Classification preview</h2>
        </div>

        {/* Per-template summary cards */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {templates.map((t) => {
            const stat = classification.byTemplate[t.template_code]
            const sel = previewFilter === t.template_code
            return (
              <button
                key={t.template_code}
                onClick={() => setPreviewFilter(sel ? 'all' : t.template_code)}
                className={`text-left px-3 py-2 border rounded-lg text-sm transition-colors ${
                  sel ? 'border-[#000080] bg-[#000080]/5' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold text-[#000080]">{t.template_code}</div>
                <div className="text-xs text-gray-500 truncate">{t.description}</div>
                <div className="mt-1 text-xs text-gray-700">
                  <span className="font-medium">{stat?.tags ?? 0}</span> tags
                  <span className="mx-1 text-gray-300">·</span>
                  <span>{stat?.types ?? 0} types</span>
                </div>
              </button>
            )
          })}
          {classification.byTemplate[UNCLASSIFIED] && (
            <button
              onClick={() => setPreviewFilter(previewFilter === UNCLASSIFIED ? 'all' : UNCLASSIFIED)}
              className={`text-left px-3 py-2 border rounded-lg text-sm col-span-2 ${
                previewFilter === UNCLASSIFIED ? 'border-red-400 bg-red-50' : 'border-red-200 bg-white hover:bg-red-50'
              }`}
            >
              <div className="font-semibold text-red-700">Unclassified</div>
              <div className="text-xs text-gray-700 mt-1">
                <span className="font-medium">{classification.byTemplate[UNCLASSIFIED].tags}</span> tags
                <span className="mx-1 text-gray-300">·</span>
                <span>{classification.byTemplate[UNCLASSIFIED].types} types</span>
              </div>
            </button>
          )}
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={previewSearch}
            onChange={(e) => setPreviewSearch(e.target.value)}
            placeholder="search instrument_type…"
            className="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm"
          />
          <select
            value={previewFilter}
            onChange={(e) => setPreviewFilter(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded text-sm"
          >
            <option value="all">All ({classification.rowResults.length})</option>
            {templates.map((t) => (
              <option key={t.template_code} value={t.template_code}>
                {t.template_code}
              </option>
            ))}
            <option value={UNCLASSIFIED}>Unclassified</option>
          </select>
        </div>

        {/* Drill-down table */}
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Instrument type</th>
                <th className="px-3 py-2 text-right w-16">Tags</th>
                <th className="px-3 py-2 text-left w-28">Template</th>
              </tr>
            </thead>
            <tbody>
              {filteredPreview.map((r) => (
                <tr key={r.type} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.type}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700">{r.n}</td>
                  <td className="px-3 py-1.5">
                    {r.template ? (
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{r.template}</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-xs font-mono">none</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredPreview.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-gray-400 text-sm">No matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
