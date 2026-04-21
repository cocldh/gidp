'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'
import RoleGuard from '@/components/RoleGuard'
import { createClient } from '@/lib/supabase-client'

interface DefaultField {
  id: number
  field_name: string
  data_kind: string
  display_order: number
}

const DATA_KINDS = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN']

export default function DefaultFieldsPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <RoleGuard minRole="Admin">
          <DefaultFieldsContent />
        </RoleGuard>
      </main>
    </div>
  )
}

function DefaultFieldsContent() {
  const supabase = createClient()
  const [fields, setFields] = useState<DefaultField[]>([])
  const [loading, setLoading] = useState(true)

  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState('TEXT')
  const [newOrder, setNewOrder] = useState(9999)
  const [adding, setAdding] = useState(false)

  useEffect(() => { loadFields() }, [])

  async function loadFields() {
    setLoading(true)
    const { data } = await supabase
      .from('default_field_def')
      .select('*')
      .order('display_order')
      .order('id')
    if (data) setFields(data)
    setLoading(false)
  }

  async function addField() {
    if (!newName.trim()) return
    setAdding(true)
    const { error } = await supabase
      .from('default_field_def')
      .insert({ field_name: newName.trim(), data_kind: newKind, display_order: newOrder })
    if (error) {
      alert(`Error: ${error.message}`)
    } else {
      setNewName('')
      setNewKind('TEXT')
      setNewOrder(9999)
      await loadFields()
    }
    setAdding(false)
  }

  async function deleteField(id: number) {
    if (!confirm('이 기본 필드를 삭제하시겠습니까?')) return
    const { error } = await supabase.from('default_field_def').delete().eq('id', id)
    if (error) alert(`Error: ${error.message}`)
    else await loadFields()
  }

  async function updateOrder(id: number, order: number) {
    const { error } = await supabase
      .from('default_field_def')
      .update({ display_order: order })
      .eq('id', id)
    if (error) alert(`Error: ${error.message}`)
    else await loadFields()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Default Fields</h1>
        <p className="text-sm text-gray-500 mt-1">
          새 프로젝트 생성 시 자동으로 추가될 기본 필드를 관리합니다.
        </p>
      </div>

      {/* Add Field */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">필드 추가</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Field Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addField()}
            className="flex-1 min-w-40 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <select
            value={newKind}
            onChange={e => setNewKind(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm"
          >
            {DATA_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            type="number"
            placeholder="Order"
            value={newOrder}
            onChange={e => setNewOrder(Number(e.target.value))}
            className="w-24 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <button
            onClick={addField}
            disabled={adding || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? '추가 중...' : '+ 추가'}
          </button>
        </div>
      </div>

      {/* Fields List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Loading...</div>
        ) : fields.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            등록된 기본 필드가 없습니다. 위에서 추가하세요.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Field Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Data Kind</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 w-28">Order</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fields.map(f => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{f.field_name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                      {f.data_kind}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      defaultValue={f.display_order}
                      onBlur={e => {
                        const v = Number(e.target.value)
                        if (v !== f.display_order) updateOrder(f.id, v)
                      }}
                      className="w-20 px-2 py-1 border border-gray-200 rounded text-xs"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteField(f.id)}
                      className="px-2 py-1 text-red-600 text-xs hover:bg-red-50 rounded border border-red-200"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        총 {fields.length}개 기본 필드 · GUI에서 새 프로젝트 생성 시 자동으로 field_def에 복사됩니다.
      </p>
    </div>
  )
}
