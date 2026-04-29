'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@gidp/auth/client';

type SearchMode = 'tag_number' | 'document_number' | 'item';

interface SearchResult {
  tag_id: number;
  tag_number: string;
  document_id?: number;
  document_number?: string;
  sheet_number?: string | null;
  template_code?: string;
  template_name?: string | null;
  item_value?: string;
  revision_number?: string | null;
  minor_revision?: string | null;
}

function formatDocNumber(docNumber?: string, sheetNumber?: string | null): string {
  if (!docNumber) return '';
  if (!sheetNumber) return docNumber;
  const padded = String(Number(sheetNumber)).padStart(3, '0');
  return `${docNumber}-${padded}`;
}

async function fetchItemValues(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  projectId: number,
  docIds: number[],
): Promise<Record<number, string>> {
  if (docIds.length === 0) return {};
  const { data } = await supabase
    .schema('iss')
    .from('document_value')
    .select('document_id, value_text, field_def!inner(field_name)')
    .eq('project_id', projectId)
    .in('document_id', docIds)
    .ilike('field_def.field_name', '%item%');
  const map: Record<number, string> = {};
  for (const dv of (data ?? []) as Array<{ document_id: number; value_text: string | null }>) {
    if (!map[dv.document_id] && dv.value_text) {
      map[dv.document_id] = dv.value_text;
    }
  }
  return map;
}

export interface TagListProps {
  projectId: number;
  /** Optional href builder for tag detail link. Defaults to /dashboard/{tagId}. */
  tagDetailHref?: (tagId: number) => string;
}

export function TagList({ projectId, tagDetailHref }: TagListProps) {
  const supabase = createBrowserSupabaseClient();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<SearchMode>('tag_number');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [queryError, setQueryError] = useState<string>('');

  async function handleSearch() {
    const q = search.trim();
    if (!q) return;

    setLoading(true);
    setSearched(true);
    setResults([]);
    setQueryError('');

    if (mode === 'tag_number') {
      const { data: tagData, error: tagError } = await supabase
        .from('tag')
        .select('tag_id, tag_number')
        .eq('project_id', projectId)
        .ilike('tag_number', `%${q}%`)
        .order('tag_number')
        .limit(2000);

      if (tagError) {
        setQueryError(`Query error: ${tagError.message} (project_id: ${projectId})`);
        setLoading(false);
        return;
      }

      const tagRows = (tagData ?? []) as Array<{ tag_id: number; tag_number: string }>;
      const tagIds = tagRows.map((t) => t.tag_id);
      const tagMap: Record<number, string> = Object.fromEntries(
        tagRows.map((t) => [t.tag_id, t.tag_number]),
      );

      if (tagIds.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      const { data: docData } = await supabase
        .schema('iss')
        .from('document')
        .select(
          'document_id, document_number, sheet_number, tag_id, revision_number, minor_revision, template:template_id(template_code, template_name)',
        )
        .eq('project_id', projectId)
        .in('tag_id', tagIds)
        .order('tag_id')
        .order('document_number')
        .limit(5000);

      const docs = (docData ?? []) as unknown as Array<{
        document_id: number;
        document_number: string;
        sheet_number: string | null;
        tag_id: number;
        revision_number: string | null;
        minor_revision: string | null;
        template: { template_code: string; template_name: string | null } | null;
      }>;
      const docIds = docs.map((d) => d.document_id);
      const itemMap = await fetchItemValues(supabase, projectId, docIds);

      setResults(
        docs.map((d) => ({
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
        })),
      );
    } else if (mode === 'document_number') {
      const { data, error: docError } = await supabase
        .schema('iss')
        .from('document')
        .select(
          'document_id, document_number, sheet_number, tag_id, revision_number, minor_revision, template:template_id(template_code, template_name)',
        )
        .eq('project_id', projectId)
        .ilike('document_number', `%${q}%`)
        .order('document_number')
        .limit(2000);

      if (docError) {
        setQueryError(`Query error: ${docError.message} (project_id: ${projectId})`);
        setLoading(false);
        return;
      }

      const docs = (data ?? []) as unknown as Array<{
        document_id: number;
        document_number: string;
        sheet_number: string | null;
        tag_id: number;
        revision_number: string | null;
        minor_revision: string | null;
        template: { template_code: string; template_name: string | null } | null;
      }>;

      const tagIds = [...new Set(docs.map((d) => d.tag_id))];
      const { data: tagData } = await supabase
        .from('tag')
        .select('tag_id, tag_number')
        .in('tag_id', tagIds);
      const tagMap: Record<number, string> = Object.fromEntries(
        ((tagData ?? []) as Array<{ tag_id: number; tag_number: string }>).map((t) => [t.tag_id, t.tag_number]),
      );

      const docIds = docs.map((d) => d.document_id);
      const itemMap = await fetchItemValues(supabase, projectId, docIds);

      setResults(
        docs.map((d) => ({
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
        })),
      );
    } else {
      const { data, error: itemError } = await supabase
        .schema('iss')
        .from('document_value')
        .select(
          'document_id, value_text, field_def!inner(field_name), document!inner(document_number, sheet_number, tag_id, revision_number, minor_revision, template:template_id(template_code, template_name))',
        )
        .eq('project_id', projectId)
        .ilike('value_text', `%${q}%`)
        .ilike('field_def.field_name', '%item%')
        .order('document_id')
        .limit(2000);

      if (itemError) {
        setQueryError(`Query error: ${itemError.message} (project_id: ${projectId})`);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as unknown as Array<{
        document_id: number;
        value_text: string | null;
        document: {
          document_number: string;
          sheet_number: string | null;
          tag_id: number;
          revision_number: string | null;
          minor_revision: string | null;
          template: { template_code: string; template_name: string | null } | null;
        } | null;
      }>;

      const tagIds = [...new Set(rows.map((r) => r.document?.tag_id).filter((id): id is number => id != null))];
      const { data: tagData } = await supabase
        .from('tag')
        .select('tag_id, tag_number')
        .in('tag_id', tagIds);
      const tagMap: Record<number, string> = Object.fromEntries(
        ((tagData ?? []) as Array<{ tag_id: number; tag_number: string }>).map((t) => [t.tag_id, t.tag_number]),
      );

      setResults(
        rows.map((dv) => ({
          tag_id: dv.document?.tag_id ?? 0,
          tag_number: tagMap[dv.document?.tag_id ?? 0] ?? '-',
          document_id: dv.document_id,
          document_number: dv.document?.document_number ?? '',
          sheet_number: dv.document?.sheet_number,
          template_code: dv.document?.template?.template_code ?? '',
          template_name: dv.document?.template?.template_name ?? null,
          item_value: dv.value_text ?? '',
          revision_number: dv.document?.revision_number ?? null,
          minor_revision: dv.document?.minor_revision ?? null,
        })),
      );
    }

    setLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }

  const hrefFor = tagDetailHref ?? ((tagId: number) => `/dashboard/${tagId}`);

  const tagCount = new Set(results.map((r) => r.tag_id)).size;
  const docCount = results.filter((r) => r.document_id != null).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold">Tags</h1>
        {searched && !loading && results.length > 0 && (
          <span className="text-sm text-gray-500">
            {tagCount} tags · {docCount} documents
          </span>
        )}
      </div>
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
          className="flex-1 min-w-48 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !search.trim()}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

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
      ) : (
        <ResultTable results={results} hrefFor={hrefFor} />
      )}
    </div>
  );
}

function ResultTable({
  results,
  hrefFor,
}: {
  results: SearchResult[];
  hrefFor: (tagId: number) => string;
}) {
  const groupMap = new Map<
    number,
    { tag_id: number; tag_number: string; docs: SearchResult[] }
  >();
  for (const r of results) {
    const existing = groupMap.get(r.tag_id);
    if (existing) {
      existing.docs.push(r);
    } else {
      groupMap.set(r.tag_id, { tag_id: r.tag_id, tag_number: r.tag_number, docs: [r] });
    }
  }
  const groups = Array.from(groupMap.values());
  const docSort = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const docKey = (d: SearchResult) => formatDocNumber(d.document_number, d.sheet_number);
  for (const g of groups) {
    g.docs.sort((a, b) => docSort(docKey(a), docKey(b)));
  }
  groups.sort((a, b) => {
    const ad = a.docs[0];
    const bd = b.docs[0];
    return docSort(ad ? docKey(ad) : '', bd ? docKey(bd) : '');
  });

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm table-auto">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">
              Tag Number
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">
              Document
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">
              Template
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Item</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">
              Rev
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groups.map((g) => (
            <tr key={g.tag_id} className="hover:bg-gray-50 align-top">
              <td className="px-4 py-3 align-top whitespace-nowrap">
                {g.tag_id ? (
                  <Link href={hrefFor(g.tag_id)} className="text-blue-600 hover:underline font-medium">
                    {g.tag_number}
                  </Link>
                ) : (
                  <span className="text-gray-400">{g.tag_number}</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-700 align-top whitespace-nowrap">
                {g.docs.map((d, i) => (
                  <div key={d.document_id ?? i}>
                    {formatDocNumber(d.document_number, d.sheet_number)}
                  </div>
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
                  <div key={d.document_id ?? i}>
                    {(d.revision_number ?? '') + (d.minor_revision ?? '')}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TagList;
