/**
 * upload-iis-templates.ts
 *
 * Uploads the 7 Aramco-standard IIS xlsx templates from docs/samples/iis/
 * to Supabase Storage at templates/iis/<code>.xlsx. Idempotent — uses
 * upsert=true so re-running overwrites in place.
 *
 * The 'templates' bucket already exists (ISS uses it). We just push new keys.
 *
 * Env (scripts/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL    — GIDP project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role (bypasses RLS / bucket policy)
 *
 * Run:
 *   pnpm --filter @gidp/scripts iis:upload-templates
 *   pnpm --filter @gidp/scripts iis:upload-templates -- --dry-run
 */

import { config as loadEnv } from 'dotenv';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__here, '.env.local') });
loadEnv({ path: resolve(__here, '.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = 'templates';
const REMOTE_DIR   = 'iis';
const LOCAL_DIR    = resolve(__here, '..', 'docs', 'samples', 'iis');
const TEMPLATE_CODES = [
  'SA-2781A', 'SA-2781B', 'SA-2781C', 'SA-2781D', 'SA-2781E',
  'SA-2799', 'SA-7076',
] as const;

const dryRun = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scripts/.env.local');
  process.exit(1);
}

async function uploadOne(code: string): Promise<{ code: string; bytes: number; status: number }> {
  const localPath = resolve(LOCAL_DIR, `${code}.xlsx`);
  const info = await stat(localPath);
  const remoteKey = `${REMOTE_DIR}/${code}.xlsx`;

  if (dryRun) {
    console.log(`[dry-run] ${localPath} (${info.size} bytes) → ${BUCKET}/${remoteKey}`);
    return { code, bytes: info.size, status: 0 };
  }

  const body = await readFile(localPath);
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remoteKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 'x-upsert: true' tells Storage to overwrite if the key exists.
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed for ${code}: ${res.status} ${text}`);
  }
  return { code, bytes: info.size, status: res.status };
}

async function main(): Promise<void> {
  console.log(`Source dir: ${LOCAL_DIR}`);
  console.log(`Target:     ${SUPABASE_URL}/storage/v1/object/${BUCKET}/${REMOTE_DIR}/`);
  console.log(`Mode:       ${dryRun ? 'dry-run' : 'live'}`);
  console.log('');

  for (const code of TEMPLATE_CODES) {
    try {
      const r = await uploadOne(code);
      console.log(`  ✓ ${code.padEnd(10)}  ${r.bytes.toString().padStart(7)} bytes  ${dryRun ? '' : `(HTTP ${r.status})`}`);
    } catch (e) {
      console.error(`  ✗ ${code}: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
