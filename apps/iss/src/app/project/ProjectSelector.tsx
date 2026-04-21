'use client'

import { useTransition } from 'react'
import { selectProject } from './actions'

interface Project {
  project_id: number
  project_code: string
  project_name: string
  description: string | null
}

export default function ProjectSelector({ projects }: { projects: Project[] }) {
  const [isPending, startTransition] = useTransition()

  function handleSelect(code: string) {
    startTransition(() => {
      selectProject(code)
    })
  }

  return (
    <div className="grid gap-4">
      {projects.map((p) => (
        <button
          key={p.project_code}
          onClick={() => handleSelect(p.project_code)}
          disabled={isPending}
          className="bg-white rounded-xl shadow hover:shadow-md border border-gray-200 hover:border-blue-400 transition-all p-6 text-left group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600">
                {p.project_name}
              </h2>
              <p className="text-sm text-gray-400 font-mono mt-0.5">schema: {p.project_code}</p>
              {p.description && (
                <p className="text-sm text-gray-500 mt-1">{p.description}</p>
              )}
            </div>
            <span className="text-blue-400 group-hover:text-blue-600 text-2xl">→</span>
          </div>
        </button>
      ))}
      {isPending && (
        <div className="text-center text-gray-400 text-sm py-2">이동 중...</div>
      )}
    </div>
  )
}
