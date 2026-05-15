"use client";

// 인덱스 파일 업로드 모달 — 드래그앤드랍, 미리보기(Preview), 업로드 처리

import { useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase-client";

interface UploadModalProps {
  open: boolean;
  projectId: number;
  /**
   * HomeClient의 AG Grid에서 추출한 { tag_number → record_id } 맵.
   * Preview 비교와 Upload upsert 분류 모두 이 맵을 사용 (DB 재조회 없음).
   */
  existingTagMap: Map<string, number>;
  onClose: () => void;
  onUploadComplete: () => void;
}

type UploadStatus = "idle" | "previewing" | "previewed" | "parsing" | "uploading" | "done" | "error";

interface PreviewResult {
  totalRows: number;
  /** 파일에만 있음 — 신규 생성 */
  newTags: string[];
  /** 파일·DB 모두 있음 — 덮어쓰기 */
  updateTags: string[];
  /** DB에만 있음 — 파일에 누락 */
  missingTags: string[];
}

interface TagListModalProps {
  title: string;
  tags: string[];
  accentClass: string;
  badgeClass: string;
  onClose: () => void;
}

function TagListModal({ title, tags, accentClass, badgeClass, onClose }: TagListModalProps) {
  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-base font-semibold ${accentClass}`}>{title}</span>
            <span className="text-xs text-gray-400 dark:text-slate-500">({tags.length.toLocaleString()}건)</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex flex-wrap gap-1.5 content-start">
          {tags.map((tag, i) => (
            <span key={`${tag}-${i}`} className={`inline-block px-2 py-0.5 rounded text-xs font-mono border ${badgeClass}`}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const BATCH_SIZE = 200;

/** 파일 헤더에서 TAG NUMBER 컬럼을 찾음 (앞 숫자 접두사 무시, 대소문자·공백 무시) */
function findTagField(headers: string[]): string | null {
  return headers.find((h) => h.replace(/^\d+_/, "").replace(/\s+/g, "").toUpperCase() === "TAGNUMBER") ?? null;
}

export default function UploadModal({ open, projectId, existingTagMap, onClose, onUploadComplete }: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState({ inserted: 0, updated: 0 });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [tagListModal, setTagListModal] = useState<"new" | "update" | "missing" | null>(null);

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress({ processed: 0, total: 0 });
    setErrorMsg("");
    setSummary({ inserted: 0, updated: 0 });
    setPreview(null);
    setTagListModal(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (status === "uploading" || status === "previewing") return;
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setStatus("idle");
      setErrorMsg("");
      setPreview(null);
    }
  };

  const parseFileRows = async (f: File): Promise<Record<string, unknown>[]> => {
    const XLSX = await import("xlsx");
    const buffer = await f.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error("파일에 시트가 없습니다.");
    const ws = wb.Sheets[firstSheet];
    if (!ws) throw new Error("시트를 읽을 수 없습니다.");
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null });
    if (rows.length === 0) throw new Error("파일에 데이터가 없습니다.");
    return rows;
  };

  const handlePreview = async () => {
    if (!file) return;
    setErrorMsg("");
    setPreview(null);
    try {
      setStatus("previewing");
      const rows = await parseFileRows(file);

      const tagField = findTagField(Object.keys(rows[0]!));
      if (!tagField) throw new Error("TAG NUMBER 컬럼을 찾을 수 없습니다. 헤더를 확인해주세요.");

      const fileTags = new Set<string>();
      for (const row of rows) {
        const raw = row[tagField];
        if (raw != null && String(raw).trim() !== "") fileTags.add(String(raw).trim());
      }

      const newTags: string[] = [];
      const updateTags: string[] = [];
      const missingTags: string[] = [];

      for (const tag of fileTags) {
        if (existingTagMap.has(tag)) updateTags.push(tag);
        else newTags.push(tag);
      }
      for (const tag of existingTagMap.keys()) {
        if (!fileTags.has(tag)) missingTags.push(tag);
      }

      setPreview({ totalRows: rows.length, newTags, updateTags, missingTags });
      setStatus("previewed");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setErrorMsg("");
    setSummary({ inserted: 0, updated: 0 });

    const baseSupabase = createClient();
    const idx = baseSupabase.schema("idx");

    try {
      setStatus("parsing");
      const rows = await parseFileRows(file);

      const firstRow = rows[0]!;
      const headers = Object.keys(firstRow);

      const tagField = findTagField(headers);
      if (!tagField) throw new Error("TAG NUMBER 컬럼을 찾을 수 없습니다.");

      // 컬럼 upsert
      const { data: existingCols } = await idx
        .from("index_column")
        .select("column_name, order_index")
        .eq("project_id", projectId)
        .order("order_index");

      const existingColRows = (existingCols as { column_name: string; order_index: number }[] | null) ?? [];
      const existingColSet = new Set(existingColRows.map((c) => c.column_name));
      const maxOrder = existingColRows.length > 0 ? Math.max(...existingColRows.map((c) => c.order_index)) : -1;

      const newCols = headers
        .filter((h) => !existingColSet.has(h))
        .map((h, i) => ({ project_id: projectId, column_name: h, order_index: maxOrder + 1 + i }));

      if (newCols.length > 0) await idx.from("index_column").insert(newCols);

      setStatus("uploading");
      setProgress({ processed: 0, total: rows.length });

      const toInsert: { project_id: number; data: Record<string, unknown>; is_committed: boolean }[] = [];
      const toUpdate: { id: number; data: Record<string, unknown> }[] = [];

      for (const rawRow of rows) {
        // 앞뒤 공백 제거 + 순수 숫자 string → number coerce (선행 0 있는 값 제외)
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawRow)) {
          if (typeof v === "string") {
            const trimmed = v.trim();
            const n = Number(trimmed);
            row[k] = trimmed !== "" && !isNaN(n) && !/^0\d/.test(trimmed) ? n : trimmed;
          } else {
            row[k] = v;
          }
        }

        const raw = row[tagField];
        const tag = raw != null ? String(raw).trim() : null;

        // 그리드 캐시(existingTagMap)로 insert/update 분류 — DB 재조회 없음
        if (tag && existingTagMap.has(tag)) {
          toUpdate.push({ id: existingTagMap.get(tag)!, data: row });
        } else {
          toInsert.push({ project_id: projectId, data: row, is_committed: true });
        }
      }

      let processed = 0;

      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error } = await idx.from("index_record").insert(batch);
        if (error) throw new Error(`Insert 오류: ${error.message}`);
        processed += batch.length;
        setProgress({ processed, total: rows.length });
      }

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((r) =>
            idx.from("index_record").update({ data: r.data }).eq("id", r.id).eq("project_id", projectId),
          ),
        );
        processed += batch.length;
        setProgress({ processed, total: rows.length });
      }

      setSummary({ inserted: toInsert.length, updated: toUpdate.length });
      localStorage.removeItem(`index_col_widths_${projectId}`);
      setStatus("done");
      onUploadComplete();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  if (!open) return null;

  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const isUploading = status === "uploading" || status === "parsing";
  const isPreviewing = status === "previewing";
  const isBusy = isUploading || isPreviewing;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div
          className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Upload Excel / CSV</h2>
            <button
              onClick={handleClose}
              disabled={isBusy}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 disabled:opacity-40"
            >
              <X size={20} />
            </button>
          </div>

          <div className="px-6 py-5 flex flex-col gap-4">
            <div
              className="border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
              onClick={() => !isBusy && fileInputRef.current?.click()}
            >
              <FileSpreadsheet size={36} className="text-gray-300 dark:text-slate-500" />
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-200">{file.name}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-gray-500 dark:text-slate-400">클릭하여 파일 선택</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">.xlsx, .xlsb, .csv 지원</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsb,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Preview 결과 — 3개 카드 */}
            {status === "previewed" && preview && (
              <div className="rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden text-sm">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
                  <Eye size={14} className="text-gray-500 dark:text-slate-400" />
                  <span className="font-medium text-gray-700 dark:text-slate-200">
                    Preview — 파일 {preview.totalRows.toLocaleString()}행
                  </span>
                </div>
                <div className="flex divide-x divide-gray-200 dark:divide-slate-600">
                  <button
                    onClick={() => preview.newTags.length > 0 && setTagListModal("new")}
                    disabled={preview.newTags.length === 0}
                    className="flex-1 flex flex-col items-center py-3 gap-0.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:cursor-default"
                  >
                    <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      {preview.newTags.length.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">신규 생성</span>
                    {preview.newTags.length > 0 && (
                      <span className="text-xs text-emerald-500 dark:text-emerald-400 mt-0.5">목록 보기 →</span>
                    )}
                  </button>
                  <button
                    onClick={() => preview.updateTags.length > 0 && setTagListModal("update")}
                    disabled={preview.updateTags.length === 0}
                    className="flex-1 flex flex-col items-center py-3 gap-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:cursor-default"
                  >
                    <span className="text-xl font-bold text-blue-500 dark:text-blue-400">
                      {preview.updateTags.length.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">덮어쓰기</span>
                    {preview.updateTags.length > 0 && (
                      <span className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">목록 보기 →</span>
                    )}
                  </button>
                  <button
                    onClick={() => preview.missingTags.length > 0 && setTagListModal("missing")}
                    disabled={preview.missingTags.length === 0}
                    className="flex-1 flex flex-col items-center py-3 gap-0.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:cursor-default"
                  >
                    <span className="text-xl font-bold text-amber-500 dark:text-amber-400">
                      {preview.missingTags.length.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">파일 누락</span>
                    {preview.missingTags.length > 0 && (
                      <span className="text-xs text-amber-500 dark:text-amber-400 mt-0.5">목록 보기 →</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {(isUploading || status === "done") && (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                  <span>
                    {status === "parsing"
                      ? "파일 파싱 중..."
                      : status === "done"
                      ? "완료"
                      : `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} 행`}
                  </span>
                  <span>{percent}%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-300 bg-blue-500"
                    style={{ width: `${status === "done" ? 100 : percent}%` }}
                  />
                </div>
              </div>
            )}

            {status === "done" && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-4 py-3">
                <CheckCircle size={16} className="shrink-0" />
                <span>
                  완료: <strong>{summary.inserted}</strong>건 삽입, <strong>{summary.updated}</strong>건 업데이트
                </span>
              </div>
            )}

            {status === "error" && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
                <AlertCircle size={16} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-slate-700">
            <button
              onClick={handleClose}
              disabled={isBusy}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              {status === "done" ? "Close" : "Cancel"}
            </button>
            {status !== "done" && (
              <>
                <button
                  onClick={handlePreview}
                  disabled={!file || isBusy}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-500 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium flex items-center gap-2 disabled:opacity-40"
                >
                  {isPreviewing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Previewing...
                    </>
                  ) : (
                    <>
                      <Eye size={15} />
                      Preview
                    </>
                  )}
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || isBusy}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center gap-2 disabled:opacity-40"
                >
                  {isUploading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={15} />
                      Upload
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {tagListModal === "new" && preview && (
        <TagListModal
          title="신규 생성 Tag"
          tags={preview.newTags}
          accentClass="text-emerald-600 dark:text-emerald-400"
          badgeClass="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700"
          onClose={() => setTagListModal(null)}
        />
      )}
      {tagListModal === "update" && preview && (
        <TagListModal
          title="덮어쓰기 Tag"
          tags={preview.updateTags}
          accentClass="text-blue-500 dark:text-blue-400"
          badgeClass="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700"
          onClose={() => setTagListModal(null)}
        />
      )}
      {tagListModal === "missing" && preview && (
        <TagListModal
          title="파일 누락 Tag (DB에만 존재)"
          tags={preview.missingTags}
          accentClass="text-amber-500 dark:text-amber-400"
          badgeClass="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700"
          onClose={() => setTagListModal(null)}
        />
      )}
    </>
  );
}
