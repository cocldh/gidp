import Navbar from '@/components/Navbar'
import BrowserClient from './BrowserClient'

export default function BrowserPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-full mx-auto px-4 py-4">
        <BrowserClient />
      </main>
    </div>
  )
}
