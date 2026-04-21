import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const formCode = searchParams.get('form')
  try {
    const filePath = path.join(process.cwd(), '..', 'extract_column_order.json')
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (formCode) {
      return NextResponse.json({ order: data[formCode] ?? [] })
    }
    return NextResponse.json({ order: {} })
  } catch {
    return NextResponse.json({ order: [] })
  }
}
