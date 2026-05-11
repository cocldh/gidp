# @gidp/drawings

Drawings zone — IIS (Instrument Installation Schedule) MVP, JB Wiring / Loop / Hook-up next.

- Port 3003 in dev, mounted at `/drawings` under shell via multi-zone rewrite.
- Auth gated by `@gidp/auth` middleware (`proxy.ts`); requires `gidp_project_id` cookie set by shell.
- IIS engine pattern mirrors `apps/iss/src/app/api/generate/route.ts` — JSZip + xmldom over Aramco-standard xlsx templates from Supabase Storage `templates/iis/`. No PDF: user converts manually.

Schema reference: `supabase/migrations/015_iis_schema.sql`.
