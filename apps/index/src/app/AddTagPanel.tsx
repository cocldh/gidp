"use client";

import { useState, useMemo, useEffect } from "react";
import { X, Tag, Loader2, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { createClient } from "@/lib/supabase-client";

interface Props {
  open: boolean;
  projectId: number;
  columnFields: string[];
  isStreaming: boolean;
  checkTagExists: (tagCol: string, tag: string) => boolean;
  getLoopTagInfo: (loopCol: string, loopOrdCol: string | undefined, loop: string) => { count: number; maxOrder: number | null };
  onClose: () => void;
  onTagAdded: (newRow: Record<string, unknown>) => void;
}

// Exact match first; fall back to ends-with so "INTERNAL LOOP ORDER" matches "LOOP ORDER".
function findColName(fields: string[], semantic: string): string | undefined {
  const norm = semantic.toUpperCase();
  const exact = fields.find((f) => f.replace(/^\d+_/, "").toUpperCase() === norm);
  if (exact) return exact;
  return fields.find((f) => f.replace(/^\d+_/, "").toUpperCase().endsWith(norm));
}

export default function AddTagPanel({
  open, projectId, columnFields, isStreaming,
  checkTagExists, getLoopTagInfo,
  onClose, onTagAdded,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const idx = useMemo(() => supabase.schema("idx"), [supabase]);

  const tagCol    = useMemo(() => findColName(columnFields, "TAG NUMBER")  ?? "1_TAG NUMBER", [columnFields]);
  const loopCol   = useMemo(() => findColName(columnFields, "LOOP NUMBER"),  [columnFields]);
  const loopOrdCol= useMemo(() => findColName(columnFields, "LOOP ORDER"),   [columnFields]);
  const serviceCol= useMemo(() => findColName(columnFields, "SERVICE"),      [columnFields]);

  const [tagNumber, setTagNumber]   = useState("");
  const [loopNumber, setLoopNumber] = useState("");
  const [loopOrder, setLoopOrder]   = useState("");
  const [service, setService]       = useState("");
  const [saving, setSaving]         = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Reset when panel closes
  useEffect(() => {
    if (!open) {
      setTagNumber(""); setLoopNumber(""); setLoopOrder(""); setService("");
      setSubmitError("");
    }
  }, [open]);

  // Duplicate check — synchronous scan of the live AG Grid store via prop callback
  const isDuplicate = useMemo(() => {
    const tag = tagNumber.trim();
    return tag ? checkTagExists(tagCol, tag) : false;
  }, [tagNumber, tagCol, checkTagExists]);

  // Loop info — count + max order for the entered loop number
  const loopInfo = useMemo(() => {
    const loop = loopNumber.trim();
    if (!loop || !loopCol) return null;
    return getLoopTagInfo(loopCol, loopOrdCol, loop);
  }, [loopNumber, loopCol, loopOrdCol, getLoopTagInfo]);

  const tagStatus = tagNumber.trim() === "" ? "idle" : isDuplicate ? "duplicate" : "ok";

  const handleSubmit = async () => {
    const tag = tagNumber.trim();
    if (!tag)          { setSubmitError("Tag Number is required."); return; }
    if (isDuplicate)   { setSubmitError("이미 존재하는 Tag Number입니다."); return; }

    setSaving(true);
    setSubmitError("");

    const data: Record<string, unknown> = { [tagCol]: tag };
    if (loopCol    && loopNumber.trim()) data[loopCol]    = loopNumber.trim();
    if (loopOrdCol && loopOrder.trim())  data[loopOrdCol] = loopOrder.trim();
    if (serviceCol && service.trim())    data[serviceCol] = service.trim();

    const { data: inserted, error: err } = await idx
      .from("index_record")
      .insert({ project_id: projectId, data, is_committed: true })
      .select("id, data")
      .single();

    if (err) { setSubmitError(err.message); setSaving(false); return; }

    onTagAdded({
      ...(inserted as { id: number; data: Record<string, unknown> }).data,
      id: (inserted as { id: number }).id,
    });
    setSaving(false);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  handleSubmit();
    if (e.key === "Escape") onClose();
  };

  if (!open) return null;

  const inputBase =
    "w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 outline-none transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700 w-full max-w-md p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Add New Tag</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Streaming warning */}
        {isStreaming && (
          <div className="mb-4 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
            <Loader2 size={12} className="animate-spin shrink-0" />
            데이터 로딩 중 — 중복 검사가 불완전할 수 있습니다.
          </div>
        )}

        <div className="flex flex-col gap-4">

          {/* Tag Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Tag Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                autoFocus
                type="text"
                value={tagNumber}
                onChange={(e) => { setTagNumber(e.target.value); setSubmitError(""); }}
                onKeyDown={onKey}
                placeholder="e.g. 10-FIC-001A"
                className={`${inputBase} pr-9 ${
                  tagStatus === "duplicate" ? "border-red-400 focus:border-red-400"
                  : tagStatus === "ok"      ? "border-green-400 focus:border-green-400"
                  :                           "border-gray-200 dark:border-slate-600 focus:border-blue-400"
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                {tagStatus === "ok"        && <CheckCircle2 size={15} className="text-green-500" />}
                {tagStatus === "duplicate" && <AlertCircle  size={15} className="text-red-500"   />}
              </span>
            </div>
            {tagStatus === "duplicate" && (
              <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={11} /> 이미 존재하는 Tag Number입니다.
              </p>
            )}
            {tagStatus === "ok" && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 size={11} /> 사용 가능한 Tag Number입니다.
              </p>
            )}
          </div>

          {/* Loop Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Loop Number{" "}
              <span className="text-gray-400 dark:text-slate-500 font-normal text-xs">(선택)</span>
            </label>
            <input
              type="text"
              value={loopNumber}
              onChange={(e) => setLoopNumber(e.target.value)}
              onKeyDown={onKey}
              placeholder="e.g. 10-FIC-001"
              className={`${inputBase} border-gray-200 dark:border-slate-600 focus:border-blue-400`}
            />
            {/* Loop info hint */}
            {loopInfo !== null && loopCol && (
              <p className="mt-1 text-xs text-blue-600 dark:text-blue-400 flex items-start gap-1">
                <Info size={11} className="mt-0.5 shrink-0" />
                {loopInfo.count === 0
                  ? "신규 Loop입니다."
                  : loopInfo.maxOrder !== null
                    ? `기존 Loop — 현재 ${loopInfo.count}개 tag, Loop Order 최대값: ${loopInfo.maxOrder} → 다음 후보: ${loopInfo.maxOrder + 1}`
                    : `기존 Loop — 현재 ${loopInfo.count}개 tag`
                }
              </p>
            )}
            {loopNumber.trim() && !loopCol && (
              <p className="mt-1 text-xs text-amber-500 flex items-center gap-1">
                <Info size={11} /> LOOP NUMBER 컬럼이 없어 저장되지 않습니다.
              </p>
            )}
          </div>

          {/* Loop Order */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Loop Order{" "}
              <span className="text-gray-400 dark:text-slate-500 font-normal text-xs">(선택)</span>
              {loopOrdCol && (
                <span className="ml-1 text-gray-300 dark:text-slate-600 font-normal text-xs">→ {loopOrdCol}</span>
              )}
            </label>
            <input
              type="text"
              value={loopOrder}
              onChange={(e) => setLoopOrder(e.target.value)}
              onKeyDown={onKey}
              placeholder={loopInfo && loopInfo.maxOrder !== null ? `다음 후보: ${loopInfo.maxOrder + 1}` : "e.g. 1"}
              className={`${inputBase} border-gray-200 dark:border-slate-600 focus:border-blue-400`}
            />
          </div>

          {/* Service */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Service{" "}
              <span className="text-gray-400 dark:text-slate-500 font-normal text-xs">(선택)</span>
            </label>
            <input
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              onKeyDown={onKey}
              placeholder="e.g. Feed Flow Control"
              className={`${inputBase} border-gray-200 dark:border-slate-600 focus:border-blue-400`}
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <AlertCircle size={13} /> {submitError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !tagNumber.trim() || isDuplicate}
              className="flex-1 py-2 rounded-lg text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Add Tag
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
