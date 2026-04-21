import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient, requireServerProjectId } from '@/lib/supabase-server';

interface TagRow {
  tag_id: number;
  project_id: number;
  tag_number: string;
  service_description: string | null;
  instrument_type: string | null;
  signal_type: string | null;
  io_type: string | null;
  loop_number: string | null;
  pnid_number: string | null;
  location: string | null;
  ex_rating: string | null;
  ex_certification: string | null;
  source_record_id: number | null;
  updated_at: string;
}

interface DocRow {
  document_id: number;
  document_number: string;
  sheet_number: string | null;
  revision_number: string | null;
  minor_revision: string | null;
  template: { template_code: string; template_name: string | null } | null;
}

interface IndexRecordRow {
  id: number;
  data: Record<string, unknown>;
}

const CORE_FIELDS: Array<[keyof TagRow, string]> = [
  ['tag_number', 'Tag Number'],
  ['service_description', 'Service'],
  ['instrument_type', 'Instrument Type'],
  ['signal_type', 'Signal Type'],
  ['io_type', 'I/O Type'],
  ['loop_number', 'Loop'],
  ['pnid_number', 'P&ID'],
  ['location', 'Location'],
  ['ex_rating', 'Ex Rating'],
  ['ex_certification', 'Ex Certification'],
];

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ tagId: string }>;
}) {
  const { tagId: raw } = await params;
  const tagId = Number.parseInt(raw, 10);
  if (!Number.isFinite(tagId)) notFound();

  const projectId = await requireServerProjectId();
  const supabase = await createClient();

  const { data: tag } = await supabase
    .from('tag')
    .select(
      'tag_id, project_id, tag_number, service_description, instrument_type, signal_type, io_type, loop_number, pnid_number, location, ex_rating, ex_certification, source_record_id, updated_at',
    )
    .eq('project_id', projectId)
    .eq('tag_id', tagId)
    .maybeSingle<TagRow>();

  if (!tag) notFound();

  const [{ data: docs }, { data: record }] = await Promise.all([
    supabase
      .schema('iss')
      .from('document')
      .select(
        'document_id, document_number, sheet_number, revision_number, minor_revision, template:template_id(template_code, template_name)',
      )
      .eq('project_id', projectId)
      .eq('tag_id', tagId)
      .order('document_number')
      .returns<DocRow[]>(),
    tag.source_record_id
      ? supabase
          .schema('idx')
          .from('index_record')
          .select('id, data')
          .eq('project_id', projectId)
          .eq('id', tag.source_record_id)
          .maybeSingle<IndexRecordRow>()
      : Promise.resolve({ data: null as IndexRecordRow | null }),
  ]);

  const documents = docs ?? [];
  const rawData = record?.data ?? null;
  const indexOnly = tag.source_record_id != null && documents.length === 0;

  const issAppHref = `/iss/dashboard/${tag.tag_id}`;

  return (
    <div className="min-h-screen bg-[#f7f4ef] dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-6">
      <main className="max-w-5xl mx-auto">
        <div className="mb-4 text-sm text-gray-500">
          <a href="/index" className="hover:text-blue-600">Master Index</a>
          {' / '}
          <span className="text-gray-900 font-medium">{tag.tag_number}</span>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
          <h1 className="text-2xl font-bold">{tag.tag_number}</h1>
          {indexOnly ? (
            <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 border border-amber-200">
              Index 전용 · ISS spec sheet 대상 아님
            </span>
          ) : documents.length > 0 ? (
            <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
              ISS documents {documents.length}
            </span>
          ) : null}
        </div>

        <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-400 mb-3 uppercase tracking-wide">
            Core fields
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {CORE_FIELDS.map(([key, label]) => {
              const val = tag[key];
              return (
                <div key={String(key)} className="flex gap-3 border-b border-gray-50 dark:border-slate-700 py-1.5">
                  <dt className="w-36 shrink-0 text-gray-500 dark:text-slate-400">{label}</dt>
                  <dd className="flex-1 font-mono text-gray-900 dark:text-slate-100 break-all">
                    {val === null || val === '' ? <span className="text-gray-300">—</span> : String(val)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wide">
              ISS documents
            </h2>
            {documents.length > 0 && (
              <Link href={issAppHref} className="text-xs text-blue-600 hover:underline">
                ISS 앱에서 열기 →
              </Link>
            )}
          </div>
          {documents.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {indexOnly
                ? '이 태그는 Index 에만 존재합니다. ISS spec sheet generation 대상이 아닙니다.'
                : '연결된 ISS document 가 없습니다.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {documents.map((d) => {
                const rev = (d.revision_number ?? '') + (d.minor_revision ?? '');
                return (
                  <li key={d.document_id} className="py-2 flex items-baseline justify-between gap-4">
                    <div>
                      <div className="font-mono font-medium">{d.document_number}{d.sheet_number ? `-${String(Number(d.sheet_number)).padStart(3, '0')}` : ''}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">
                        {d.template?.template_name
                          ? `${d.template.template_code} — ${d.template.template_name}`
                          : (d.template?.template_code ?? '')}
                        {rev ? ` · Rev ${rev}` : ''}
                      </div>
                    </div>
                    <Link
                      href={`/iss/dashboard/${tag.tag_id}`}
                      className="text-xs text-blue-600 hover:underline shrink-0"
                    >
                      열기
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {rawData && (
          <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-400 mb-3 uppercase tracking-wide">
              Index raw record (source_record_id: {tag.source_record_id})
            </h2>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {Object.entries(rawData)
                    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1 pr-4 text-gray-500 dark:text-slate-400 font-mono align-top whitespace-nowrap">{k}</td>
                        <td className="py-1 font-mono text-gray-900 dark:text-slate-100 break-all">{String(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
