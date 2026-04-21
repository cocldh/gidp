import Navbar from '@/components/Navbar'
import BrowserTable from '@/components/BrowserTable'

export default function BrowserPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-full mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Browser View</h1>
        <BrowserTable />
      </main>
    </div>
  )
}
