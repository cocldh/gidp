"use client";

import { useRef, useEffect, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import type { ColDef, GridApi, CellFocusedEvent } from "ag-grid-community";

interface DataGridProps {
  columns: ColDef[];
  rowData: any[];
  onCellValueChanged: (event: any) => void;
  onGridReady?: (api: GridApi) => void;
  isChangedCell: (recordId: number, colName: string) => boolean;
  onUndo: () => void;
}

interface RangeSel { startRow: number; endRow: number; startColIdx: number; endColIdx: number; }

const cellKey = (r: number, c: number) => `${r},${c}`;

function normRange(sel: RangeSel) {
  return {
    minRow: Math.min(sel.startRow, sel.endRow),
    maxRow: Math.max(sel.startRow, sel.endRow),
    minCol: Math.min(sel.startColIdx, sel.endColIdx),
    maxCol: Math.max(sel.startColIdx, sel.endColIdx),
  };
}

function rangeKeys(sel: RangeSel): Set<string> {
  const { minRow, maxRow, minCol, maxCol } = normRange(sel);
  const keys = new Set<string>();
  for (let r = minRow; r <= maxRow; r++)
    for (let c = minCol; c <= maxCol; c++)
      keys.add(cellKey(r, c));
  return keys;
}


export default function DataGrid({ columns, rowData, onCellValueChanged, onGridReady, isChangedCell, onUndo }: DataGridProps) {
  const gridApiRef = useRef<GridApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // 선택 모델
  // - shiftRangeRef: Shift+Click / Drag / Shift+Arrow 로 만들어진 직사각형 범위
  // - ctrlCellsRef: Ctrl+Click 으로 개별 추가된 셀들
  // - selectedCellsRef: 위 두 개의 합집합 (빠른 조회용)
  const shiftRangeRef = useRef<RangeSel | null>(null);
  const ctrlCellsRef = useRef<Set<string>>(new Set());
  const selectedCellsRef = useRef<Set<string>>(new Set());
  const anchorRef = useRef<{ row: number; col: number } | null>(null);

  // 드래그 추적 (마우스 버튼을 누른 채 다른 셀로 이동할 때만 활성화)
  const dragActiveRef = useRef(false);

  // 수정자 키 상태
  const shiftHeldRef = useRef(false);

  // onCellFocused 가 마우스 클릭에 의한 것인지 키보드에 의한 것인지 구분
  const mousedownOccurredRef = useRef(false);

  const isGridFocused = () => {
    const active = document.activeElement;
    if (!active || !containerRef.current?.contains(active)) return false;
    return active.tagName !== "INPUT" && active.tagName !== "TEXTAREA";
  };

  const scheduleRefresh = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      gridApiRef.current?.refreshCells({ force: true });
    });
  };

  // selectedCellsRef = shiftRange ∪ ctrlCells
  const rebuildSelection = () => {
    const cells = new Set<string>();
    ctrlCellsRef.current.forEach((k) => cells.add(k));
    if (shiftRangeRef.current) rangeKeys(shiftRangeRef.current).forEach((k) => cells.add(k));
    selectedCellsRef.current = cells;
  };

  // Shift / Ctrl 키 추적
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeldRef.current = true; };
    const ku = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeldRef.current = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, []);

  // 마우스 버튼 해제 → 드래그 종료
  useEffect(() => {
    const handler = () => { dragActiveRef.current = false; };
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, []);

  // window.mousemove 로 드래그 범위 확장
  // onCellMouseOver 대신 사용: AG Grid 내부 이벤트가 오발동하는 문제 회피
  const getColIdx = useCallback((colId: string) =>
    (gridApiRef.current?.getAllDisplayedColumns() ?? []).findIndex((c) => c.getColId() === colId), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.buttons & 1)) { dragActiveRef.current = false; return; } // 버튼 안눌림
      if (!dragActiveRef.current || !anchorRef.current) return;

      // 커서 아래 AG Grid 셀 DOM 요소에서 col-id / row-index 읽기
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cellEl = el?.closest?.(".ag-cell") as HTMLElement | null;
      const rowEl = el?.closest?.(".ag-row") as HTMLElement | null;
      if (!cellEl || !rowEl) return;

      const colId = cellEl.getAttribute("col-id");
      const rowIdx = parseInt(rowEl.getAttribute("row-index") ?? "-1", 10);
      if (!colId || rowIdx < 0) return;

      const colIdx = getColIdx(colId);
      if (colIdx < 0) return;

      // anchor 셀과 동일하면 단순 클릭 — 무시
      if (rowIdx === anchorRef.current.row && colIdx === anchorRef.current.col) return;

      // 다른 셀에 진입한 경우에만 드래그 범위 확장
      shiftRangeRef.current = { startRow: anchorRef.current.row, endRow: rowIdx, startColIdx: anchorRef.current.col, endColIdx: colIdx };
      rebuildSelection();
      scheduleRefresh();
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [getColIdx]);

  // 키보드: Ctrl+Z / Shift+Arrow / Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isGridFocused()) return;
      const api = gridApiRef.current;
      if (!api) return;

      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        e.preventDefault(); e.stopPropagation(); onUndo(); return;
      }

      if (e.key === "Escape") {
        ctrlCellsRef.current.clear();
        shiftRangeRef.current = null;
        rebuildSelection();
        scheduleRefresh();
        return;
      }

      if (e.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const allCols = api.getAllDisplayedColumns();
        const focused = api.getFocusedCell();
        const anchor = anchorRef.current ?? (focused
          ? { row: focused.rowIndex, col: allCols.findIndex((c) => c.getColId() === focused.column.getColId()) }
          : null);
        if (!anchor) return;

        const cur = shiftRangeRef.current ?? { startRow: anchor.row, endRow: anchor.row, startColIdx: anchor.col, endColIdx: anchor.col };
        let { endRow, endColIdx } = cur;

        if (e.key === "ArrowDown") endRow = Math.min(endRow + 1, api.getDisplayedRowCount() - 1);
        if (e.key === "ArrowUp")   endRow = Math.max(endRow - 1, 0);
        if (e.key === "ArrowRight") endColIdx = Math.min(endColIdx + 1, allCols.length - 1);
        if (e.key === "ArrowLeft")  endColIdx = Math.max(endColIdx - 1, 0);

        anchorRef.current = anchor;
        shiftRangeRef.current = { startRow: anchor.row, endRow, startColIdx: anchor.col, endColIdx };
        rebuildSelection();
        scheduleRefresh();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onUndo]);

  // Copy: 선택 범위 전체를 탭/줄바꿈 형식으로
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isGridFocused()) return;
      const api = gridApiRef.current;
      if (!api) return;
      e.preventDefault();

      const cells = selectedCellsRef.current;
      const allCols = api.getAllDisplayedColumns();

      if (cells.size === 0) {
        const focused = api.getFocusedCell();
        if (!focused) return;
        const node = api.getDisplayedRowAtIndex(focused.rowIndex);
        const field = focused.column.getColDef().field;
        const v = field && node ? node.data[field] : "";
        e.clipboardData?.setData("text/plain", v == null ? "" : String(v));
        return;
      }

      let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
      cells.forEach((key) => {
        const [r, c] = key.split(",").map(Number);
        minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
        minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
      });

      const lines: string[] = [];
      for (let r = minRow; r <= maxRow; r++) {
        const node = api.getDisplayedRowAtIndex(r);
        const vals: string[] = [];
        for (let c = minCol; c <= maxCol; c++) {
          if (cells.has(cellKey(r, c))) {
            const field = allCols[c]?.getColDef().field;
            const v = field && node ? node.data[field] : "";
            vals.push(v == null ? "" : String(v));
          } else {
            vals.push("");
          }
        }
        lines.push(vals.join("\t"));
      }
      e.clipboardData?.setData("text/plain", lines.join("\n"));
    };
    window.addEventListener("copy", handler);
    return () => window.removeEventListener("copy", handler);
  }, []);

  // Paste: 선택 범위 좌상단(또는 포커스 셀)부터
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isGridFocused()) return;
      const api = gridApiRef.current;
      if (!api) return;
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault();

      const parsedRows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd().split("\n").map((r) => r.split("\t"));
      const allCols = api.getAllDisplayedColumns();
      const cells = selectedCellsRef.current;
      const focused = api.getFocusedCell();

      let startRow: number, startCol: number;
      if (cells.size > 0) {
        let minRow = Infinity, minCol = Infinity;
        cells.forEach((key) => {
          const [r, c] = key.split(",").map(Number);
          minRow = Math.min(minRow, r); minCol = Math.min(minCol, c);
        });
        startRow = minRow; startCol = minCol;
      } else if (focused) {
        startRow = focused.rowIndex;
        startCol = allCols.findIndex((c) => c.getColId() === focused.column.getColId());
      } else {
        return;
      }

      parsedRows.forEach((rowVals, rOff) => {
        const node = api.getDisplayedRowAtIndex(startRow + rOff);
        if (!node) return;
        rowVals.forEach((val, cOff) => {
          const col = allCols[startCol + cOff];
          if (!col) return;
          const field = col.getColDef().field;
          if (!field || field === "id") return;
          node.setDataValue(field, val === "" ? null : val);
        });
      });
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);

  // AG Grid: 셀 포커스 변경 (키보드 화살표 이동 시 선택 초기화)
  const onCellFocused = (e: CellFocusedEvent) => {
    // 마우스 클릭에 의한 포커스 변경은 onCellMouseDown 에서 처리
    if (mousedownOccurredRef.current) { mousedownOccurredRef.current = false; return; }
    // Shift+Arrow 는 keydown 핸들러에서 처리
    if (shiftHeldRef.current) return;
    if (e.rowIndex == null || !e.column) return;

    const colId = (e.column as any).getColId?.();
    if (!colId) return;
    const colIdx = getColIdx(colId);
    if (colIdx < 0) return;

    ctrlCellsRef.current.clear();
    shiftRangeRef.current = { startRow: e.rowIndex, endRow: e.rowIndex, startColIdx: colIdx, endColIdx: colIdx };
    anchorRef.current = { row: e.rowIndex, col: colIdx };
    rebuildSelection();
    scheduleRefresh();
  };

  // AG Grid: 마우스 클릭 → 선택 처리
  const onCellMouseDown = (e: any) => {
    mousedownOccurredRef.current = true;
    const colIdx = getColIdx(e.column?.getColId?.() ?? "");
    const rowIdx: number = e.rowIndex ?? 0;

    if (e.event?.shiftKey) {
      // Shift+클릭: anchor → 현재 셀 직사각형 범위
      const anchor = anchorRef.current ?? { row: rowIdx, col: colIdx };
      shiftRangeRef.current = { startRow: anchor.row, endRow: rowIdx, startColIdx: anchor.col, endColIdx: colIdx };
      anchorRef.current = anchor;
    } else if (e.event?.ctrlKey || e.event?.metaKey) {
      // Ctrl+클릭: 개별 셀 토글
      const key = cellKey(rowIdx, colIdx);
      if (ctrlCellsRef.current.has(key)) {
        ctrlCellsRef.current.delete(key);
      } else {
        ctrlCellsRef.current.add(key);
        anchorRef.current = { row: rowIdx, col: colIdx };
      }
    } else {
      // 일반 클릭: 모든 선택 해제 후 단일 셀 선택, 드래그 추적 시작
      ctrlCellsRef.current.clear();
      shiftRangeRef.current = { startRow: rowIdx, endRow: rowIdx, startColIdx: colIdx, endColIdx: colIdx };
      anchorRef.current = { row: rowIdx, col: colIdx };
      dragActiveRef.current = true;
    }

    rebuildSelection();
    scheduleRefresh();
  };

  return (
    <div
      ref={containerRef}
      className="ag-theme-alpine"
      style={{ width: "100%", height: "calc(100vh - 130px)", fontFamily: '"Calibri", Arial, sans-serif' }}
    >
      <AgGridReact
        rowData={rowData}
        columnDefs={columns}
        onCellValueChanged={onCellValueChanged}
        onGridReady={(e) => { gridApiRef.current = e.api; onGridReady?.(e.api); }}
        onCellFocused={onCellFocused}
        onCellMouseDown={onCellMouseDown}
        pagination={true}
        paginationPageSize={30000}
        rowSelection="single"
        suppressRowClickSelection={true}
        animateRows={true}
        suppressHorizontalScroll={false}
        {...{ suppressUndoRedoCellEditing: true } as any}
        defaultColDef={{
          resizable: true,
          sortable: true,
          filter: true,
          cellStyle: (params) => {
            const rowIdx = params.node.rowIndex ?? -1;
            const allCols = gridApiRef.current?.getAllDisplayedColumns() ?? [];
            const colIdx = allCols.findIndex((c) => c.getColId() === params.column.getColId());
            if (selectedCellsRef.current.has(cellKey(rowIdx, colIdx))) {
              return { backgroundColor: "#bfdbfe" };
            }
            if (params.colDef.field !== "id" && isChangedCell(params.data?.id, params.colDef.field as string)) {
              return { backgroundColor: "#fefce8" };
            }
            // null 대신 "" 반환 — AG Grid는 null 시 이전 인라인 스타일을 지우지 않음
            return { backgroundColor: "" };
          },
        }}
      />
    </div>
  );
}
