'use client'

import { useMemo, useState } from 'react'

interface TemplateRow {
  template_code: string
  description: string | null
}

interface Props {
  templates: TemplateRow[]
}

type Target = { kind: 'template'; code: string } | { kind: 'auto' }

const MID_LETTERS = [
  { value: '', label: '전체 (필터 없음)' },
  { value: 'P', label: 'P — Pressure loops' },
  { value: 'T', label: 'T — Temperature loops' },
  { value: 'F', label: 'F — Flow loops' },
  { value: 'L', label: 'L — Level loops' },
  { value: 'A', label: 'A — Analyzer loops' },
]

export default function GenerationForm({ templates }: Props) {
  const [target, setTarget] = useState<Target>(
    templates.length > 0 ? { kind: 'template', code: templates[0].template_code } : { kind: 'auto' },
  )
  const [midLetter, setMidLetter] = useState<string>('')
  const [revNo, setRevNo] = useState<string>('')
  const [docNo, setDocNo] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const targetLabel = useMemo(() => {
    if (target.kind === 'auto') return 'Auto (classification 적용 · 모든 템플릿)'
    return target.code
  }, [target])

  async function handleGenerate() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const body: Record<string, unknown> = {}
      if (target.kind === 'auto') {
        body.mode = 'auto'
      } else {
        body.mode = 'all'
        body.template_code = target.code
      }
      if (midLetter) body.filter = { kind: 'loop_mid_letter', value: midLetter }
      if (revNo.trim()) body.rev_no = revNo.trim()
      if (docNo.trim()) body.doc_no = docNo.trim()

      const res = await fetch('/drawings/api/iis/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          msg = (JSON.parse(text) as { error?: string }).error ?? text
        } catch { /* keep raw text */ }
        throw new Error(`${res.status}: ${msg}`)
      }

      const totalTags = res.headers.get('X-IIS-Total-Tags')
      const stamped = res.headers.get('X-IIS-Stamped-Tags')
      const unclassified = res.headers.get('X-IIS-Unclassified')
      const overflowed = res.headers.get('X-IIS-Overflowed') === '1'
      const usedTemplates = res.headers.get('X-IIS-Templates')

      // Filename from Content-Disposition
      const disp = res.headers.get('Content-Disposition') ?? ''
      const fnMatch = disp.match(/filename="([^"]+)"/)
      const filename = fnMatch
        ? fnMatch[1]
        : target.kind === 'auto'
          ? `IIS_auto${midLetter ? `_${midLetter}` : ''}.zip`
          : `${target.code}${midLetter ? `_${midLetter}` : ''}_all.zip`

      const blob = await res.blob()
      if (blob.size === 0) throw new Error('Empty response body — nothing to download')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      // Defer cleanup so the browser has time to open its Save As dialog and
      // read from the blob URL before we revoke it. Revoking synchronously
      // can cancel the download silently when the user has "Ask where to save
      // each file" enabled.
      setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(url)
      }, 60_000)

      const parts: string[] = [`Downloaded ${filename}`]
      if (totalTags) parts.push(`tags=${totalTags}`)
      if (stamped) parts.push(`stamped=${stamped}`)
      if (unclassified) parts.push(`unclassified=${unclassified}`)
      if (usedTemplates) parts.push(`templates=${usedTemplates}`)
      if (overflowed) parts.push('OVERFLOWED — some pages exceeded data_row range')
      setInfo(parts.join(' · '))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Target picker */}
      <section className="border border-gray-200 rounded-lg bg-white p-5">
        <div className="text-sm font-semibold text-gray-800 mb-3">Target</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {templates.map((t) => {
            const sel = target.kind === 'template' && target.code === t.template_code
            return (
              <button
                key={t.template_code}
                onClick={() => setTarget({ kind: 'template', code: t.template_code })}
                className={`text-left px-3 py-2 border rounded-lg text-sm transition-colors ${
                  sel ? 'border-[#000080] bg-[#000080]/5' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold text-[#000080]">{t.template_code}</div>
                <div className="text-xs text-gray-500 truncate">{t.description}</div>
              </button>
            )
          })}
          <button
            onClick={() => setTarget({ kind: 'auto' })}
            className={`text-left px-3 py-2 border rounded-lg text-sm transition-colors md:col-span-2 ${
              target.kind === 'auto'
                ? 'border-[#000080] bg-[#000080]/5'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="font-semibold text-[#000080]">Auto</div>
            <div className="text-xs text-gray-500">
              Classification rule 로 모든 태그를 자동 라우팅 → 7 개 템플릿 ZIP 한 번에 + UNCLASSIFIED.csv + SUMMARY.txt
            </div>
          </button>
        </div>
      </section>

      {/* Options */}
      <section className="border border-gray-200 rounded-lg bg-white p-5">
        <div className="text-sm font-semibold text-gray-800 mb-3">Options</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="text-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Loop mid letter</div>
            <select
              value={midLetter}
              onChange={(e) => setMidLetter(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
            >
              {MID_LETTERS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Revision (rev_no_cells)</div>
            <input
              type="text"
              value={revNo}
              onChange={(e) => setRevNo(e.target.value)}
              placeholder="예: 0"
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm font-mono"
            />
          </label>
          <label className="text-sm">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Document no (doc_no_cell)</div>
            <input
              type="text"
              value={docNo}
              onChange={(e) => setDocNo(e.target.value)}
              placeholder="예: D44-IIS-PT-001"
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm font-mono"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Rev / Doc 은 비워두면 해당 셀을 건드리지 않습니다. Auto 모드에서는 모든 템플릿에 동일하게 stamp 됨.
        </p>
      </section>

      {/* Submit */}
      <section className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          선택: <span className="font-mono text-gray-800">{targetLabel}</span>
          {midLetter && <> · filter: <span className="font-mono text-gray-800">{midLetter}</span></>}
        </div>
        <button
          onClick={handleGenerate}
          disabled={busy}
          className="px-4 py-2 bg-[#000080] text-white rounded text-sm hover:bg-[#000060] disabled:opacity-40"
        >
          {busy ? 'Generating…' : 'Generate & Download'}
        </button>
      </section>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}
      {info && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
          {info}
        </div>
      )}
    </div>
  )
}
