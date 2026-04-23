'use client'

import dynamic from 'next/dynamic'

const BrowserTable = dynamic(() => import('@/components/BrowserTable'), { ssr: false })

export default function BrowserClient() {
  return <BrowserTable />
}
