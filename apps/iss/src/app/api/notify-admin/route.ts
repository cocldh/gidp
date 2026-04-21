import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  const apiKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ADMIN_EMAIL
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

  if (!apiKey || !adminEmail) {
    console.warn(`[notify-admin] RESEND_API_KEY or ADMIN_EMAIL not set — skipping email for: ${email}`)
    return NextResponse.json({ ok: true })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'ISS Web <onboarding@resend.dev>',
        to: [adminEmail],
        subject: '[ISS Web] New User Sign-up — Approval Required',
        html: `
          <div style="font-family:sans-serif;max-width:480px;">
            <h2 style="color:#1d4ed8;">New User Sign-up</h2>
            <p>A new user has registered and is waiting for your approval:</p>
            <p style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:15px;">
              <strong>${email}</strong>
            </p>
            <p>Please log in to the admin panel to approve or manage this user:</p>
            <a href="${siteUrl}/admin/users"
               style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
              Go to User Management
            </a>
            <p style="color:#6b7280;font-size:12px;margin-top:24px;">ISS Web — Instrument Specification Sheet Management</p>
          </div>
        `,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[notify-admin] Resend error ${res.status}:`, body)
    } else {
      console.log(`[notify-admin] Email sent to ${adminEmail} for new user: ${email}`)
    }
  } catch (err) {
    console.error('[notify-admin] Fetch failed:', err)
  }

  return NextResponse.json({ ok: true })
}
