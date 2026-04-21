'use client'

import { useEffect, useState } from 'react'
import { readProjectIdCookie } from '@/lib/supabase-client'
import { TagList as BaseTagList } from '@gidp/ui/tag-list'

export default function TagList() {
  const [projectId, setProjectId] = useState<number | null>(null)

  useEffect(() => {
    setProjectId(readProjectIdCookie())
  }, [])

  if (projectId == null) {
    return (
      <div className="text-center text-gray-500 py-8">
        프로젝트가 선택되지 않았습니다.
      </div>
    )
  }

  return <BaseTagList projectId={projectId} />
}
