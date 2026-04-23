import Navbar from '@/components/Navbar'
import BrowserClient from './BrowserClient'

export default function BrowserPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-full mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Browser View</h1>
        <BrowserClient />
      </main>
    </div>
  )
}
