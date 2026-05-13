// IIS 서브모듈 내부 2차 네비게이션 바
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/iis', label: 'Overview', exact: true },
  { href: '/iis/mapping', label: 'Column Mapping', exact: false },
  { href: '/iis/classification', label: 'Classification', exact: false },
  { href: '/iis/generate', label: 'Generation', exact: false },
]

export default function IisSubnav() {
  const pathname = usePathname()

  return (
    <div className="px-6 pb-3">
      <div className="flex items-center gap-1 border-b border-gray-200 pb-0">
        {TABS.map(({ href, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
                (active
                  ? 'border-[#000080] text-[#000080]'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300')
              }
            >
              {label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
