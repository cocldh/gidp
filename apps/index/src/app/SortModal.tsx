// AG Grid 다중 정렬 조건을 엑셀 스타일로 설정하는 모달
"use client";

import { useState, useEffect } from "react";
import { X, Plus, Trash2, ArrowUpDown, ArrowUp, ArrowDown, GripVertical } from "lucide-react";

export interface SortCondition {
  colId: string;
  direction: "asc" | "desc";
}

interface SortModalProps {
  open: boolean;
  columns: string[];
  initialConditions: SortCondition[];
  onApply: (conditions: SortCondition[]) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function SortModal({ open, columns, initialConditions, onApply, onClear, onClose }: SortModalProps) {
  const [conditions, setConditions] = useState<SortCondition[]>([]);

  useEffect(() => {
    if (open) {
      setConditions(
        initialConditions.length > 0
          ? initialConditions
          : [{ colId: columns[0] ?? "", direction: "asc" }],
      );
    }
  }, [open, initialConditions, columns]);

  if (!open) return null;

  const addCondition = () => {
    // 아직 사용 안 된 컬럼 중 첫 번째를 기본값으로
    const usedCols = new Set(conditions.map((c) => c.colId));
    const nextCol = columns.find((c) => !usedCols.has(c)) ?? columns[0] ?? "";
    setConditions((prev) => [...prev, { colId: nextCol, direction: "asc" }]);
  };

  const removeCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCol = (idx: number, colId: string) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, colId } : c)));
  };

  const toggleDirection = (idx: number) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, direction: c.direction === "asc" ? "desc" : "asc" } : c)),
    );
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setConditions((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setConditions((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
            <ArrowUpDown size={16} className="text-blue-500" />
            정렬 기준 설정
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {/* Conditions list */}
        <div className="flex flex-col gap-2 px-5 py-4 max-h-80 overflow-y-auto">
          {conditions.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-4">
              정렬 기준이 없습니다. 아래 버튼으로 추가하세요.
            </p>
          )}
          {conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {/* 순서 이동 */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className="text-gray-300 hover:text-gray-500 dark:text-slate-600 dark:hover:text-slate-300 disabled:opacity-20"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => moveDown(idx)}
                  disabled={idx === conditions.length - 1}
                  className="text-gray-300 hover:text-gray-500 dark:text-slate-600 dark:hover:text-slate-300 disabled:opacity-20"
                >
                  <ArrowDown size={13} />
                </button>
              </div>

              {/* 우선순위 뱃지 */}
              <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-xs font-bold flex items-center justify-center shrink-0">
                {idx + 1}
              </span>

              {/* 컬럼 선택 */}
              <select
                value={cond.colId}
                onChange={(e) => updateCol(idx, e.target.value)}
                className="flex-1 text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 outline-none focus:border-blue-400 min-w-0"
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>

              {/* 오름차순 / 내림차순 토글 */}
              <button
                onClick={() => toggleDirection(idx)}
                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors shrink-0 ${
                  cond.direction === "asc"
                    ? "border-blue-300 text-blue-600 bg-blue-50 dark:border-blue-600 dark:text-blue-300 dark:bg-blue-900/30"
                    : "border-orange-300 text-orange-600 bg-orange-50 dark:border-orange-600 dark:text-orange-300 dark:bg-orange-900/30"
                }`}
              >
                {cond.direction === "asc" ? (
                  <><ArrowUp size={12} /> 오름차순</>
                ) : (
                  <><ArrowDown size={12} /> 내림차순</>
                )}
              </button>

              {/* 삭제 */}
              <button
                onClick={() => removeCondition(idx)}
                className="text-gray-300 hover:text-red-400 dark:text-slate-600 dark:hover:text-red-400 shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        {/* Add condition */}
        <div className="px-5 pb-3">
          <button
            onClick={addCondition}
            disabled={conditions.length >= columns.length}
            className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            기준 추가
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 dark:border-slate-700">
          <button
            onClick={() => { onClear(); onClose(); }}
            className="text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            정렬 초기화
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              취소
            </button>
            <button
              onClick={() => { onApply(conditions); onClose(); }}
              className="text-sm px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium"
            >
              적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
