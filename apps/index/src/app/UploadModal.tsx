"use client";

import { useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase-client";

interface UploadModalProps {
  open: boolean;
  projectId: number;
  onClose: () => void;
  onUploadComplete: () => void;
}

type UploadStatus = "idle" | "parsing" | "uploading" | "done" | "error";

const BATCH_SIZE = 200;
const PK_FIELD = "TAGNUMBER";

export default function UploadModal({ open, projectId, onClose, onUploadComplete }: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState({ inserted: 0, updated: 0 });

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress({ processed: 0, total: 0 });
    setErrorMsg("");
    setSummary({ inserted: 0, updated: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (status === "uploading") return;
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setStatus("idle");
      setErrorMsg("");
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
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        setErrorMsg("파일에 시트가 없습니다.");
        setStatus("error");
        return;
      }
      const ws = wb.Sheets[firstSheet];
      if (!ws) {
        setErrorMsg("시트를 읽을 수 없습니다.");
        setStatus("error");
        return;
      }
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null });

      if (rows.length === 0) {
        setErrorMsg("파일에 데이터가 없습니다.");
        setStatus("error");
        return;
      }

      const firstRow = rows[0]!;
      const headers = Object.keys(firstRow);

      // Upsert columns scoped to this project
      const { data: existingCols } = await idx
        .from("index_column")
        .select("column_name, order_index")
        .eq("project_id", projectId)
        .order("order_index");

      const existingRows = (existingCols as { column_name: string; order_index: number }[] | null) ?? [];
      const existingSet = new Set(existingRows.map((c) => c.column_name));
      const maxOrder = existingRows.length > 0 ? Math.max(...existingRows.map((c) => c.order_index)) : -1;

      const newCols = headers
        .filter((h) => !existingSet.has(h))
        .map((h, i) => ({
          project_id: projectId,
          column_name: h,
          order_index: maxOrder + 1 + i,
        }));

      if (newCols.length > 0) {
        await idx.from("index_column").insert(newCols);
      }

      setStatus("uploading");
      setProgress({ processed: 0, total: rows.length });

      // Build TAGNUMBER -> id map for this project
      const tagToId = new Map<string, number>();
      let from = 0;
      while (true) {
        const { data: chunk, error } = await idx
          .from("index_record")
          .select(`id, data->${PK_FIELD}`)
          .eq("project_id", projectId)
          .range(from, from + 999);
        if (error || !chunk || chunk.length === 0) break;
        for (const r of chunk as { id: number; [key: string]: unknown }[]) {
          const tag = r[PK_FIELD];
          if (tag != null) tagToId.set(String(tag), r.id);
        }
        if (chunk.length < 1000) break;
        from += 1000;
      }

      const toInsert: { project_id: number; data: Record<string, unknown>; is_committed: boolean }[] = [];
      const toUpdate: { id: number; data: Record<string, unknown> }[] = [];

      for (const row of rows) {
        const rawTag = row[PK_FIELD];
        const tag = rawTag != null ? String(rawTag) : null;
        if (tag && tagToId.has(tag)) {
          toUpdate.push({ id: tagToId.get(tag)!, data: row });
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
            idx
              .from("index_record")
              .update({ data: r.data })
              .eq("id", r.id)
              .eq("project_id", projectId),
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

  return (
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
            disabled={isUploading}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <div
            className="border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            onClick={() => !isUploading && fileInputRef.current?.click()}
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
            disabled={isUploading}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
          >
            {status === "done" ? "Close" : "Cancel"}
          </button>
          {status !== "done" && (
            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
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
          )}
        </div>
      </div>
    </div>
  );
}
