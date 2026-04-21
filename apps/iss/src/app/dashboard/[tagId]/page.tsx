'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import DocumentFields from '@/components/DocumentFields'
import { useUserRole } from '@/components/RoleGuard'
import { createClient, createSchemaClient } from '@/lib/supabase-client'
import type { Tag, Document } from '@/lib/types'

export default function TagDetailPage() {
  const params = useParams()
  const tagId = parseInt(params.tagId as string)
  const supabase = createSchemaClient()  // 프로젝트 스키마 적용

  const { hasRole, loading: roleLoading } = useUserRole()
  const canGenerate = !roleLoading && hasRole('Engineer')

  const [tag, setTag] = useState<Tag | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<number | null>(null)

  async function loadDocuments() {
    const { data: docs } = await supabase
      .from('document')
      .select('*, template(template_code, template_name)')
      .eq('tag_id', tagId)
      .order('document_number')
    if (docs) setDocuments(docs)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: tagData } = await supabase
        .from('tag')
        .select('*')
        .eq('tag_id', tagId)
        .single()
      if (tagData) setTag(tagData)

      const { data: docs } = await supabase
        .from('document')
        .select('*, template(template_code, template_name)')
        .eq('tag_id', tagId)
        .order('document_number')
      if (docs) {
        setDocuments(docs)
        if (docs.length > 0) setSelectedDocId(docs[0].document_id)
      }

      setLoading(false)
    }
    load()
  }, [tagId])

  async function handleGenerate(docId: number) {
    setGenerating(docId)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: [docId] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = err.details?.length ? '\n\n' + err.details.join('\n') : ''
        alert((err.error || 'Generation failed') + details)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="(.+?)"/)
      const filename = match ? match[1] : 'document.xlsx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Generation failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setGenerating(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-gray-500">Loading...</div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <div className="mb-4 text-sm text-gray-500">
          <Link href="/dashboard" className="hover:text-blue-600">Dashboard</Link>
          {' / '}
          <span className="text-gray-900 font-medium">{tag?.tag_number ?? `Tag ${tagId}`}</span>
        </div>

        <h1 className="text-2xl font-bold mb-4">{tag?.tag_number}</h1>

        {documents.length === 0 ? (
          <p className="text-gray-500">No documents found for this tag.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Document list */}
            <div className="lg:col-span-1">
              <h2 className="text-sm font-semibold text-gray-600 mb-2">
                Documents ({documents.length})
              </h2>
              <div className="bg-white rounded-lg shadow overflow-hidden">
                {documents.map((doc) => (
                  <div
                    key={doc.document_id}
                    className={`flex items-center border-b border-gray-100 ${
                      selectedDocId === doc.document_id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <button
                      onClick={() => setSelectedDocId(doc.document_id)}
                      className={`flex-1 text-left px-3 py-2.5 text-sm hover:bg-gray-50 ${
                        selectedDocId === doc.document_id ? 'text-blue-700 font-medium' : ''
                      }`}
                    >
                      <div className="font-medium truncate">{doc.document_number}</div>
                      <div className="text-xs text-gray-500">
                        {(doc.template as any)?.template_name
                          ? `${(doc.template as any).template_code} - ${(doc.template as any).template_name}`
                          : ((doc.template as any)?.template_code ?? '')}
                        {doc.sheet_number ? ` / Sheet ${doc.sheet_number}` : ''}
                        {(doc.revision_number || (doc as any).minor_revision) ? ` / Rev ${(doc.revision_number ?? '') + ((doc as any).minor_revision ?? '')}` : ''}
                      </div>
                    </button>
                    {canGenerate && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGenerate(doc.document_id) }}
                        disabled={generating === doc.document_id}
                        className="px-2 py-1 mr-2 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
                        title="Generate ISS Form"
                      >
                        {generating === doc.document_id ? '...' : 'Generate'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Field values */}
            <div className="lg:col-span-3">
              {selectedDocId && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h2 className="text-sm font-semibold text-gray-600 mb-3">Field Values</h2>
                  <DocumentFields documentId={selectedDocId} tagId={tagId} onRevisionCommit={loadDocuments} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
