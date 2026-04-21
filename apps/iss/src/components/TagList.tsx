'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSchemaClient, getProjectSchema } from '@/lib/supabase-client'

type SearchMode = 'tag_number' | 'document_number' | 'item'

interface SearchResult {
  tag_id: number
  tag_number: string
  document_id?: number
  document_number?: string
  sheet_number?: string | null
  template_code?: string
  template_name?: string | null
  item_value?: string
  revision_number?: string | null
  minor_revision?: string | null
}

function formatDocNumber(docNumber?: string, sheetNumber?: string | null): string {
  if (!docNumber) return ''
  if (!sheetNumber) return docNumber
  const padded = String(Number(sheetNumber)).padStart(3, '0')
  return `${docNumber}-${padded}`
}

async function fetchItemValues(
  supabase: ReturnType<typeof import('@/lib/supabase-client').createClient>,
  docIds: number[]
): Promise<Record<number, string>> {
  if (docIds.length === 0) return {}
  const { data } = await supabase
    .from('document_value')
    .select('document_id, value_text, field_def!inner(field_name)')
    .in('document_id', docIds)
    .ilike('field_def.field_name', '%item%')
  const map: Record<number, string> = {}
  for (const dv of data ?? []) {
    if (!map[(dv as any).document_id] && (dv as any).value_text) {
      map[(dv as any).document_id] = (dv as any).value_text
    }
  }
  return map
}

export default function TagList() {
  const supabase = createSchemaClient()
  const [results, setResults] = useState<SearchResult[]>([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<SearchMode>('tag_number')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [queryError, setQueryError] = useState<string>('')

  async function handleSearch() {
    const q = search.trim()
    if (!q) return

    setLoading(true)
    setSearched(true)
    setResults([])
    setQueryError('')

    if (mode === 'tag_number') {
      const { data: tagData, error: tagError } = await supabase
        .from('tag')
        .select('tag_id, tag_number')
        .ilike('tag_number', `%${q}%`)
        .order('tag_number')
        .limit(200)

      if (tagError) {
        setQueryError(`Query error: ${tagError.message} (schema: ${getProjectSchema()})`)
        setLoading(false)
        return
      }

      const tagIds = (tagData ?? []).map((t) => t.tag_id)
      const tagMap: Record<number, string> = Object.fromEntries(
        (tagData ?? []).map((t) => [t.tag_id, t.tag_number])
      )

      if (tagIds.length === 0) {
        setResults([])
        setLoading(false)
        return
      }

      const { data: docData } = await supabase
        .from('document')
        .select('document_id, document_number, sheet_number, tag_id, revision_number, minor_revision, template(template_code, template_name)')
        .in('tag_id', tagIds)
        .order('tag_id')
        .order('document_number')
        .limit(500)

      const docIds = (docData ?? []).map((d: any) => d.document_id)
      const itemMap = await fetchItemValues(supabase, docIds)

      setResults(
        (docData ?? []).map((d: any) => ({
          tag_id: d.tag_id,
          tag_number: tagMap[d.tag_id] ?? '-',
          document_id: d.document_id,
          document_number: d.document_number,
          sheet_number: d.sheet_number,
          template_code: d.template?.template_code ?? '',
          template_name: d.template?.template_name ?? null,
          item_value: itemMap[d.document_id] ?? '',
          revision_number: d.revision_number ?? null,
          minor_revision: d.minor_revision ?? null,
        }))
      )
    } else if (mode === 'document_number') {
      const { data, error: docError } = await supabase
        .from('document')
        .select('document_id, document_number, sheet_number, tag_id, revision_number, minor_revision, tag(tag_number), template(template_code, template_name)')
        .ilike('document_number', `%${q}%`)
        .order('document_number')
        .limit(500)

      if (docError) {
        setQueryError(`Query error: ${docError.message} (schema: ${getProjectSchema()})`)
        setLoading(false)
        return
      }

      const docIds = (data ?? []).map((d: any) => d.document_id)
      const itemMap = await fetchItemValues(supabase, docIds)

      setResults(
        (data ?? []).map((d: any) => ({
          tag_id: d.tag_id,
          tag_number: d.tag?.tag_number ?? '-',
          document_id: d.document_id,
          document_number: d.document_number,
          sheet_number: d.sheet_number,
          template_code: d.template?.template_code ?? '',
          template_name: d.template?.template_name ?? null,
          item_value: itemMap[d.document_id] ?? '',
          revision_number: d.revision_number ?? null,
          minor_revision: d.minor_revision ?? null,
        }))
      )
    } else if (mode === 'item') {
      const { data, error: itemError } = await supabase
        .from('document_value')
        .select('document_id, value_text, field_def!inner(field_name), document!inner(document_number, sheet_number, tag_id, revision_number, minor_revision, tag(tag_number), template(template_code, template_name))')
        .ilike('value_text', `%${q}%`)
        .ilike('field_def.field_name', '%item%')
        .order('document_id')
        .limit(500)

      if (itemError) {
        setQueryError(`Query error: ${itemError.message} (schema: ${getProjectSchema()})`)
        setLoading(false)
        return
      }

      setResults(
        (data ?? []).map((dv: any) => ({
          tag_id: dv.document?.tag_id,
          tag_number: dv.document?.tag?.tag_number ?? '-',
          document_id: dv.document_id,
          document_number: dv.document?.document_number ?? '',
          sheet_number: dv.document?.sheet_number,
          template_code: dv.document?.template?.template_code ?? '',
          template_name: dv.document?.template?.template_name ?? null,
          item_value: dv.value_text,
          revision_number: dv.document?.revision_number ?? null,
          minor_revision: dv.document?.minor_revision ?? null,
        }))
      )
    }

    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <div>
      {/* Search controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as SearchMode)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="tag_number">Tag Number</option>
          <option value="document_number">Document Number</option>
          <option value="item">Item</option>
        </select>
        <input
          type="text"
          placeholder={
            mode === 'tag_number'
              ? 'Search tag number...'
              : mode === 'document_number'
              ? 'Search document number...'
              : 'Search item value...'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-48 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !search.trim()}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Results */}
      {queryError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-mono whitespace-pre-wrap">
          {queryError}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-8">Searching...</div>
      ) : !searched ? (
        <div className="text-center text-gray-400 py-8">Enter a keyword and click Search</div>
      ) : results.length === 0 && !queryError ? (
        <div className="text-center text-gray-500 py-8">No results found</div>
      ) : (() => {
        // Group results by tag_id
        const groupMap = new Map<number, { tag_id: number; tag_number: string; docs: SearchResult[] }>()
        for (const r of results) {
          if (!groupMap.has(r.tag_id)) {
            groupMap.set(r.tag_id, { tag_id: r.tag_id, tag_number: r.tag_number, docs: [] })
          }
          groupMap.get(r.tag_id)!.docs.push(r)
        }
        const groups = Array.from(groupMap.values())
        // Sort by formatted document number (includes sheet, e.g. ee-150601-032-017)
        const docSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        const docKey = (d: SearchResult) => formatDocNumber(d.document_number, d.sheet_number)
        for (const g of groups) {
          g.docs.sort((a, b) => docSort(docKey(a), docKey(b)))
        }
        // Sort groups by first doc's formatted key
        groups.sort((a, b) => docSort(docKey(a.docs[0]), docKey(b.docs[0])))
        return (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm table-auto">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Tag Number</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Document</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Template</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Item</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Rev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groups.map((g) => (
                  <tr key={g.tag_id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {g.tag_id ? (
                        <Link
                          href={`/dashboard/${g.tag_id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {g.tag_number}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{g.tag_number}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 align-top whitespace-nowrap">
                      {g.docs.map((d, i) => (
                        <div key={d.document_id ?? i}>{formatDocNumber(d.document_number, d.sheet_number)}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-gray-500 align-top whitespace-nowrap">
                      {g.docs.map((d, i) => (
                        <div key={d.document_id ?? i}>
                          {d.template_name ? `${d.template_code} - ${d.template_name}` : (d.template_code ?? '')}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-gray-700 align-top whitespace-nowrap">
                      {g.docs.map((d, i) => (
                        <div key={d.document_id ?? i}>{d.item_value ?? ''}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-gray-500 align-top whitespace-nowrap">
                      {g.docs.map((d, i) => (
                        <div key={d.document_id ?? i}>{(d.revision_number ?? '') + (d.minor_revision ?? '')}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
              {groups.length} tags ({results.length} documents)
            </div>
          </div>
        )
      })()}
    </div>
  )
}
