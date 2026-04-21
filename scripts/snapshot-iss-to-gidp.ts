/**
 * snapshot-iss-to-gidp.ts
 *
 * Legacy ISS Supabase 의 e230350 schema (FGIP2 프로젝트) 전체를
 * GIDP Supabase 의 iss.* + public.tag 로 단방향 복제.
 *
 * - Source는 read-only (SET TRANSACTION READ ONLY). 기존 시스템 건드리지 않음.
 * - 모든 레코드에 project_id = 2 (GIDP FGIP2) 부여.
 * - Source pk 값을 그대로 유지 (GIDP 비어있음 가정). insert 후 sequence setval.
 * - 멱등: ON CONFLICT (pk) DO UPDATE — 다시 돌려도 안전.
 * - auth.users 는 복제 불가 (Supabase 제약). document_revision.committed_by 등은 text 값만 유지.
 *
 * 실행 모드 (둘 다 active 불가능한 경우 dump → apply 2패스):
 *
 *   pnpm --filter @gidp/scripts snapshot:iss:dump          # source 만 연결, dump/iss-snapshot.jsonl 생성
 *   pnpm --filter @gidp/scripts snapshot:iss:apply         # dest 만 연결, 위 파일을 읽어 insert
 *
 * 또는 한 번에 (두 연결 동시 가능할 때):
 *   pnpm --filter @gidp/scripts snapshot:iss:dry           # 양쪽 연결 + row count 만
 *   pnpm --filter @gidp/scripts snapshot:iss               # 양쪽 연결 + 실제 복제
 *
 * 필수 환경변수 (scripts/.env.local):
 *   ISS_LEGACY_DB_URL  — lyqsabfezsmapbzdnlko direct/session-pooler URI (dump 모드에서 필수)
 *   GIDP_DB_URL        — crtsgykvmowpxqfqchgy direct/session-pooler URI (apply 모드에서 필수)
 */

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve, dirname as pathDirname } from 'node:path';

// scripts/.env.local 을 스크립트 위치 기준으로 명시 로드 (cwd 에 의존하지 않도록)
const __here = pathDirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__here, '.env.local') });
loadEnv({ path: resolve(__here, '.env') });
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';


const FIXED_PROJECT_ID = 2;
const SOURCE_SCHEMA    = 'e230350';
const BATCH_SIZE       = 1000;
const DEFAULT_DUMP     = 'dump/iss-snapshot.jsonl';

type Mode = 'full' | 'dry-run' | 'dump' | 'apply';

function parseMode(argv: string[]): { mode: Mode; dumpPath: string } {
  const dumpIdx  = argv.indexOf('--dump');
  const applyIdx = argv.indexOf('--apply');
  const dryRun   = argv.includes('--dry-run');
  let dumpPath = DEFAULT_DUMP;
  let mode: Mode = 'full';
  if (dumpIdx >= 0)  { mode = 'dump';    if (argv[dumpIdx + 1]  && !argv[dumpIdx + 1].startsWith('--'))  dumpPath = argv[dumpIdx + 1]; }
  if (applyIdx >= 0) { mode = 'apply';   if (argv[applyIdx + 1] && !argv[applyIdx + 1].startsWith('--')) dumpPath = argv[applyIdx + 1]; }
  if (dryRun && mode === 'full') mode = 'dry-run';
  return { mode, dumpPath };
}

const { mode, dumpPath } = parseMode(process.argv.slice(2));
const needsSource = mode === 'dump'  || mode === 'full' || mode === 'dry-run';
const needsDest   = mode === 'apply' || mode === 'full' || mode === 'dry-run';

const ISS_LEGACY_DB_URL = process.env.ISS_LEGACY_DB_URL;
const GIDP_DB_URL       = process.env.GIDP_DB_URL;

if (needsSource && !ISS_LEGACY_DB_URL) {
  console.error('Missing ISS_LEGACY_DB_URL (required for mode: ' + mode + ').');
  process.exit(1);
}
if (needsDest && !GIDP_DB_URL) {
  console.error('Missing GIDP_DB_URL (required for mode: ' + mode + ').');
  process.exit(1);
}

type Row = Record<string, unknown>;

interface CopyStep {
  label: string;
  sourceSql: string;
  destTable: string;
  destColumns: string[];
  conflictColumns: string[];
  map: (row: Row) => unknown[];
  sequence?: { name: string; pkColumn: string };
  skip?: (row: Row) => boolean;
}

const steps: CopyStep[] = [
  {
    label: 'public.tag',
    sourceSql: `SELECT tag_id, tag_number FROM ${SOURCE_SCHEMA}.tag ORDER BY tag_id`,
    destTable: 'public.tag',
    destColumns: ['tag_id', 'project_id', 'tag_number'],
    conflictColumns: ['tag_id'],
    map: r => [r.tag_id, FIXED_PROJECT_ID, r.tag_number],
    sequence: { name: 'public.tag_tag_id_seq', pkColumn: 'tag_id' },
  },
  {
    label: 'iss.template',
    sourceSql: `SELECT template_id, template_code, template_name FROM ${SOURCE_SCHEMA}.template ORDER BY template_id`,
    destTable: 'iss.template',
    destColumns: ['template_id', 'project_id', 'template_code', 'template_name'],
    conflictColumns: ['template_id'],
    map: r => [r.template_id, FIXED_PROJECT_ID, r.template_code, r.template_name],
    sequence: { name: 'iss.template_template_id_seq', pkColumn: 'template_id' },
  },
  {
    label: 'iss.field_def',
    sourceSql: `SELECT field_id, field_name, data_kind, display_order FROM ${SOURCE_SCHEMA}.field_def ORDER BY field_id`,
    destTable: 'iss.field_def',
    destColumns: ['field_id', 'project_id', 'field_name', 'data_kind', 'display_order'],
    conflictColumns: ['field_id'],
    map: r => [r.field_id, FIXED_PROJECT_ID, r.field_name, r.data_kind, r.display_order],
    sequence: { name: 'iss.field_def_field_id_seq', pkColumn: 'field_id' },
  },
  {
    label: 'iss.mapping_rule',
    sourceSql: `SELECT mapping_id, template_id, field_id, data_type, target_sheet, target_cell, remark
                FROM ${SOURCE_SCHEMA}.mapping_rule ORDER BY mapping_id`,
    destTable: 'iss.mapping_rule',
    destColumns: ['mapping_id', 'project_id', 'template_id', 'field_id', 'data_type', 'target_sheet', 'target_cell', 'remark'],
    conflictColumns: ['mapping_id'],
    map: r => [r.mapping_id, FIXED_PROJECT_ID, r.template_id, r.field_id, r.data_type, r.target_sheet, r.target_cell, r.remark],
    sequence: { name: 'iss.mapping_rule_mapping_id_seq', pkColumn: 'mapping_id' },
  },
  {
    label: 'iss.mapping_option',
    sourceSql: `SELECT option_id, mapping_id, expected_value FROM ${SOURCE_SCHEMA}.mapping_option ORDER BY option_id`,
    destTable: 'iss.mapping_option',
    destColumns: ['option_id', 'mapping_id', 'expected_value'],
    conflictColumns: ['option_id'],
    map: r => [r.option_id, r.mapping_id, r.expected_value],
    skip: r => r.mapping_id == null,
    sequence: { name: 'iss.mapping_option_option_id_seq', pkColumn: 'option_id' },
  },
  {
    label: 'iss.document',
    sourceSql: `SELECT document_id, template_id, document_number, sheet_number, revision_number, minor_revision, tag_id
                FROM ${SOURCE_SCHEMA}.document ORDER BY document_id`,
    destTable: 'iss.document',
    destColumns: ['document_id', 'project_id', 'template_id', 'document_number', 'sheet_number', 'revision_number', 'minor_revision', 'tag_id'],
    conflictColumns: ['document_id'],
    map: r => [r.document_id, FIXED_PROJECT_ID, r.template_id, r.document_number, r.sheet_number, r.revision_number, r.minor_revision, r.tag_id],
    sequence: { name: 'iss.document_document_id_seq', pkColumn: 'document_id' },
  },
  {
    label: 'iss.document_value',
    sourceSql: `SELECT document_id, field_id, value_text FROM ${SOURCE_SCHEMA}.document_value`,
    destTable: 'iss.document_value',
    destColumns: ['document_id', 'field_id', 'value_text'],
    conflictColumns: ['document_id', 'field_id'],
    map: r => [r.document_id, r.field_id, r.value_text],
  },
  {
    label: 'iss.document_revision',
    sourceSql: `SELECT revision_id, document_id, revision_number, revision_type, note, committed_at, committed_by
                FROM ${SOURCE_SCHEMA}.document_revision ORDER BY revision_id`,
    destTable: 'iss.document_revision',
    destColumns: ['revision_id', 'document_id', 'revision_number', 'revision_type', 'note', 'committed_at', 'committed_by'],
    conflictColumns: ['revision_id'],
    map: r => [r.revision_id, r.document_id, r.revision_number, r.revision_type, r.note, r.committed_at ?? new Date(), r.committed_by],
    skip: r => r.document_id == null,
    sequence: { name: 'iss.document_revision_revision_id_seq', pkColumn: 'revision_id' },
  },
  {
    label: 'iss.document_revision_detail',
    sourceSql: `SELECT detail_id, revision_id, document_number, tag_number, field_name, previous_value, new_value, changed_at, changed_by
                FROM ${SOURCE_SCHEMA}.document_revision_detail ORDER BY detail_id`,
    destTable: 'iss.document_revision_detail',
    destColumns: ['detail_id', 'revision_id', 'document_number', 'tag_number', 'field_name', 'previous_value', 'new_value', 'changed_at', 'changed_by'],
    conflictColumns: ['detail_id'],
    map: r => [
      r.detail_id, r.revision_id, r.document_number ?? '', r.tag_number,
      r.field_name ?? '', r.previous_value, r.new_value, r.changed_at ?? new Date(), r.changed_by,
    ],
    skip: r => r.revision_id == null,
    sequence: { name: 'iss.document_revision_detail_detail_id_seq', pkColumn: 'detail_id' },
  },
  {
    label: 'iss.document_value_change',
    sourceSql: `SELECT document_id, field_id, previous_value, changed_at, changed_by, tag_number, template_code, field_name, new_value
                FROM ${SOURCE_SCHEMA}.document_value_change`,
    destTable: 'iss.document_value_change',
    destColumns: ['document_id', 'field_id', 'previous_value', 'changed_at', 'changed_by', 'tag_number', 'template_code', 'field_name', 'new_value'],
    conflictColumns: ['document_id', 'field_id'],
    map: r => [
      r.document_id, r.field_id, r.previous_value, r.changed_at ?? new Date(), r.changed_by,
      r.tag_number, r.template_code, r.field_name, r.new_value,
    ],
  },
];

function buildInsertSql(step: CopyStep, batchSize: number): string {
  const colList = step.destColumns.map(c => `"${c}"`).join(', ');
  const placeholders: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    const offset = i * step.destColumns.length;
    const params = step.destColumns.map((_, j) => `$${offset + j + 1}`).join(', ');
    placeholders.push(`(${params})`);
  }
  const updateCols = step.destColumns
    .filter(c => !step.conflictColumns.includes(c))
    .map(c => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  const conflictTarget = step.conflictColumns.map(c => `"${c}"`).join(', ');
  const onConflict = updateCols
    ? `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateCols}`
    : `ON CONFLICT (${conflictTarget}) DO NOTHING`;
  // GIDP 쪽 identity 컬럼(GENERATED ALWAYS)에 소스 PK 를 그대로 박기 위해 override.
  // sequence 가 지정된 step 은 PK 보존 대상 → OVERRIDING SYSTEM VALUE 필요.
  const override = step.sequence ? 'OVERRIDING SYSTEM VALUE ' : '';
  return `INSERT INTO ${step.destTable} (${colList}) ${override}VALUES ${placeholders.join(', ')} ${onConflict}`;
}

async function insertBatches(dest: Client, step: CopyStep, rows: Row[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const sql = buildInsertSql(step, batch.length);
    const params = batch.flatMap(r => step.map(r));
    await dest.query(sql, params);
    inserted += batch.length;
    if (i % (BATCH_SIZE * 10) === 0 || i + BATCH_SIZE >= rows.length) {
      process.stdout.write(`\r  inserted ${inserted}/${rows.length}`);
    }
  }
  if (rows.length > 0) process.stdout.write('\n');
  return inserted;
}

async function resetSequence(dest: Client, step: CopyStep): Promise<void> {
  if (!step.sequence) return;
  const { rows: [{ max }] } = await dest.query(
    `SELECT COALESCE(MAX("${step.sequence.pkColumn}"), 0) AS max FROM ${step.destTable}`
  );
  await dest.query(`SELECT setval('${step.sequence.name}', $1)`, [Math.max(Number(max), 1)]);
  console.log(`  sequence ${step.sequence.name} → ${max}`);
}

/* -------- dump -------- */
async function runDump(dumpPath: string) {
  const source = new Client({ connectionString: ISS_LEGACY_DB_URL });
  await source.connect();
  await source.query('BEGIN');
  await source.query('SET TRANSACTION READ ONLY');

  mkdirSync(dirname(dumpPath), { recursive: true });
  const out = createWriteStream(dumpPath, { encoding: 'utf8' });
  const writeLine = (obj: unknown) => out.write(JSON.stringify(obj) + '\n');

  writeLine({ type: 'header', version: 1, fixedProjectId: FIXED_PROJECT_ID, sourceSchema: SOURCE_SCHEMA, generatedAt: new Date().toISOString() });

  try {
    for (const step of steps) {
      console.log(`\n→ dump ${step.label}`);
      const { rows } = await source.query(step.sourceSql);
      const total = rows.length;
      const filtered = step.skip ? rows.filter(r => !step.skip!(r)) : rows;
      const skipped = total - filtered.length;
      console.log(`  source rows: ${total}${skipped ? ` (skip ${skipped} due to NOT NULL)` : ''}`);
      writeLine({ type: 'step', label: step.label, rows: filtered.length });
      for (const row of filtered) writeLine({ type: 'row', label: step.label, data: row });
    }
    writeLine({ type: 'end' });
  } finally {
    await source.query('ROLLBACK');
    await source.end();
    await new Promise<void>(res => out.end(() => res()));
  }
  console.log(`\n✓ dump written: ${dumpPath}`);
}

/* -------- apply -------- */
async function runApply(dumpPath: string) {
  if (!existsSync(dumpPath)) {
    console.error(`Dump file not found: ${dumpPath}`);
    process.exit(1);
  }
  const dest = new Client({ connectionString: GIDP_DB_URL });
  await dest.connect();

  const { rows: projRows } = await dest.query(
    'SELECT project_id, project_code FROM public.project WHERE project_id = $1',
    [FIXED_PROJECT_ID]
  );
  if (projRows.length === 0) {
    throw new Error(`GIDP public.project 에 project_id=${FIXED_PROJECT_ID} 없음.`);
  }
  console.log(`target project: ${projRows[0].project_code} (id ${projRows[0].project_id})`);

  const stepByLabel = new Map(steps.map(s => [s.label, s]));
  const rl = createInterface({ input: createReadStream(dumpPath, { encoding: 'utf8' }), crlfDelay: Infinity });

  let current: CopyStep | null = null;
  let buffer: Row[] = [];
  const flush = async () => {
    if (!current || buffer.length === 0) return;
    await insertBatches(dest, current, buffer);
    buffer = [];
  };

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (rec.type === 'header') {
        console.log(`dump generatedAt=${rec.generatedAt} projectId=${rec.fixedProjectId}`);
      } else if (rec.type === 'step') {
        await flush();
        if (current) await resetSequence(dest, current);
        current = stepByLabel.get(rec.label) ?? null;
        if (!current) throw new Error(`Unknown step in dump: ${rec.label}`);
        console.log(`\n→ apply ${current.label} (${rec.rows} rows)`);
      } else if (rec.type === 'row') {
        buffer.push(rec.data);
        if (buffer.length >= BATCH_SIZE) {
          await insertBatches(dest, current!, buffer);
          buffer = [];
        }
      } else if (rec.type === 'end') {
        await flush();
        if (current) await resetSequence(dest, current);
        current = null;
      }
    }
    await flush();
    if (current) await resetSequence(dest, current);
  } finally {
    await dest.end();
  }
  console.log('\n✓ apply complete');
}

/* -------- full (both connections) -------- */
async function runFull(dryRun: boolean) {
  const source = new Client({ connectionString: ISS_LEGACY_DB_URL });
  const dest   = new Client({ connectionString: GIDP_DB_URL });
  await source.connect();
  await dest.connect();
  console.log(`mode: ${dryRun ? 'DRY RUN' : 'LIVE COPY'}`);

  await source.query('BEGIN');
  await source.query('SET TRANSACTION READ ONLY');

  const { rows: projRows } = await dest.query(
    'SELECT project_id, project_code FROM public.project WHERE project_id = $1',
    [FIXED_PROJECT_ID]
  );
  if (projRows.length === 0) throw new Error(`GIDP project_id=${FIXED_PROJECT_ID} 없음.`);
  console.log(`target project: ${projRows[0].project_code} (id ${projRows[0].project_id})`);

  try {
    for (const step of steps) {
      console.log(`\n→ ${step.label}`);
      const { rows } = await source.query(step.sourceSql);
      const filtered = step.skip ? rows.filter(r => !step.skip!(r)) : rows;
      console.log(`  source rows: ${rows.length}${rows.length !== filtered.length ? ` (skip ${rows.length - filtered.length})` : ''}`);
      if (dryRun) {
        console.log(`  [dry-run] would insert ${filtered.length}`);
        continue;
      }
      await insertBatches(dest, step, filtered);
      await resetSequence(dest, step);
    }
  } finally {
    await source.query('ROLLBACK');
    await source.end();
    await dest.end();
  }
}

async function main() {
  console.log(`mode=${mode}  dumpPath=${dumpPath}`);
  switch (mode) {
    case 'dump':    return runDump(dumpPath);
    case 'apply':   return runApply(dumpPath);
    case 'dry-run': return runFull(true);
    case 'full':    return runFull(false);
  }
}

main().catch(err => {
  console.error('\n!!! snapshot failed:', err);
  process.exit(1);
});
