import { NextResponse } from 'next/server'

export async function GET() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  // Test actual download
  let downloadStatus = 'not tested'
  let responseBody = ''
  let requestUrl = ''
  try {
    requestUrl = `${url}/storage/v1/object/templates/SA-2616.xlsx`
    const res = await fetch(requestUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    })
    downloadStatus = `${res.status} ${res.statusText}`
    if (!res.ok) {
      responseBody = await res.text()
    } else {
      responseBody = `OK, content-type: ${res.headers.get('content-type')}, size: ${res.headers.get('content-length')}`
    }
  } catch (e) {
    downloadStatus = `error: ${e instanceof Error ? e.message : 'unknown'}`
  }

  // Also test listing buckets
  let bucketsStatus = 'not tested'
  try {
    const bucketsRes = await fetch(`${url}/storage/v1/bucket`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    })
    if (bucketsRes.ok) {
      const buckets = await bucketsRes.json()
      bucketsStatus = `OK, buckets: ${buckets.map((b: { name: string }) => b.name).join(', ')}`
    } else {
      bucketsStatus = `${bucketsRes.status} ${await bucketsRes.text()}`
    }
  } catch (e) {
    bucketsStatus = `error: ${e instanceof Error ? e.message : 'unknown'}`
  }

  return NextResponse.json({
    serviceKeyPrefix: serviceKey.substring(0, 20) + '...',
    serviceKeyLength: serviceKey.length,
    urlPrefix: url.substring(0, 30) + '...',
    requestUrl,
    downloadStatus,
    responseBody,
    bucketsStatus,
  })
}
