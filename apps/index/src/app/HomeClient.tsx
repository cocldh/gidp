"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import ExcelJS from "exceljs";
import { Download, Upload, Columns, Loader2, Search, FilterX, Moon, Sun, Star, Trash2, Plus, History, Save, LogOut, FolderKanban, ArrowLeftRight, Home, Tag, X } from "lucide-react";
import type { ColDef, GridApi } from "ag-grid-community";
import { RoleGuard, useUserRole } from "@gidp/ui";
import { createClient } from "@/lib/supabase-client";
import UploadModal from "./UploadModal";
import AddTagPanel from "./AddTagPanel";

const DataGrid = dynamic(() => import("./DataGrid"), { ssr: false });

interface Favorite {
  id: number;
  name: string;
  hiddenFields: string[];
}

interface PendingChange {
  recordId: number;
  fieldName: string;
  originalValue: unknown;
  currentValue: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowNode: any;
}

interface UndoEntry {
  recordId: number;
  fieldName: string;
  oldValue: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowNode: any;
}

export default function HomeClient({ projectId }: { projectId: number }) {
  return (
    <RoleGuard projectId={projectId} module="idx" minAccess="Viewer">
      <HomeContent projectId={projectId} />
    </RoleGuard>
  );
}

function HomeContent({ projectId }: { projectId: number }) {
  const baseSupabase = useMemo(() => createClient(), []);
  const idx = useMemo(() => baseSupabase.schema("idx"), [baseSupabase]);

  const [columns, setColumns] = useState<ColDef[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rowData, setRowData] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [displayRowCount, setDisplayRowCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const loadIdRef = useRef(0);

  const [darkMode, setDarkMode] = useState(false);
  const gridApiRef = useRef<GridApi | null>(null);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [savingName, setSavingName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [showAddTag, setShowAddTag] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveReason, setSaveReason] = useState("");

  const [showAddColumnInput, setShowAddColumnInput] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [addColumnError, setAddColumnError] = useState("");
  const [deleteColumnTarget, setDeleteColumnTarget] = useState<string | null>(null);

  const [colJumpQuery, setColJumpQuery] = useState("");
  const [colJumpMatches, setColJumpMatches] = useState<string[]>([]);
  const [colJumpIdx, setColJumpIdx] = useState(0);

  const changedCellsRef = useRef<Set<string>>(new Set());
  const changedCellsInfoRef = useRef<Map<string, { reason: string | null; changedAt: string }>>(new Map());
  const [uncommittedCount, setUncommittedCount] = useState(0);

  const pendingChanges = useRef<Map<string, PendingChange>>(new Map());
  const undoStack = useRef<UndoEntry[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const isUndoing = useRef(false);

  const { email: userEmail, moduleAccess, isProjectRole, hasModuleAccess } = useUserRole(projectId, "idx");
  const canDeleteColumn = isProjectRole("ProjectAdmin");

  const [projectName, setProjectName] = useState<string>("");
  useEffect(() => {
    baseSupabase
      .from("project")
      .select("project_name")
      .eq("project_id", projectId)
      .single()
      .then(({ data }) => setProjectName(data?.project_name ?? String(projectId)));
  }, [baseSupabase, projectId]);

  // Load favorites for this project
  useEffect(() => {
    idx
      .from("index_favorite")
      .select("id, name, hidden_fields")
      .eq("project_id", projectId)
      .order("created_at")
      .then(({ data }) => {
        if (data) {
          setFavorites(
            (data as { id: number; name: string; hidden_fields: string[] }[]).map((r) => ({
              id: r.id,
              name: r.name,
              hiddenFields: r.hidden_fields ?? [],
            })),
          );
        }
      });
  }, [idx, projectId]);

  const saveFavorite = async () => {
    const name = savingName.trim();
    if (!name) return;
    const hidden = Array.from(hiddenFields);
    const { data: { user } } = await baseSupabase.auth.getUser();
    const { data } = await idx
      .from("index_favorite")
      .upsert(
        {
          project_id: projectId,
          name,
          hidden_fields: hidden,
          created_by: user?.id ?? null,
        },
        { onConflict: "project_id,name" },
      )
      .select("id, name, hidden_fields")
      .single();
    if (data) {
      const row = data as { id: number; name: string; hidden_fields: string[] };
      setFavorites((prev) => [
        ...prev.filter((f) => f.name !== row.name),
        { id: row.id, name: row.name, hiddenFields: row.hidden_fields ?? [] },
      ]);
    }
    setSavingName("");
    setShowSaveInput(false);
  };

  const applyFavorite = (fav: Favorite) => {
    setHiddenFields(new Set(fav.hiddenFields));
  };

  const deleteFavorite = async (fav: Favorite) => {
    await idx.from("index_favorite").delete().eq("id", fav.id);
    setFavorites((prev) => prev.filter((f) => f.id !== fav.id));
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowColumnPanel(false);
        setShowSaveInput(false);
      }
    }
    if (showColumnPanel) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showColumnPanel]);

  const loadData = useCallback(async () => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    setHiddenFields(new Set());
    pendingChanges.current.clear();
    undoStack.current = [];
    setPendingCount(0);

    const PAGE = 1000;

    // Phase 1: columns + first chunk + audit log, all in parallel.
    // count: "exact" removed — triggers a full-table scan on PostgREST and can
    // return an empty error object on large tables. Streaming condition uses
    // firstRows.length === PAGE instead.
    const [colRes, firstRes, auditRes] = await Promise.all([
      idx
        .from("index_column")
        .select("column_name, order_index")
        .eq("project_id", projectId)
        .order("order_index"),
      idx
        .from("index_record")
        .select("id, data")
        .eq("project_id", projectId)
        .order("id")
        .range(0, PAGE - 1),
      idx
        .from("index_audit_log")
        .select("record_id, column_name, change_reason, changed_at")
        .eq("project_id", projectId)
        .eq("committed", false)
        .order("changed_at", { ascending: false })
        .range(0, 9999),
    ]);

    if (colRes.error) {
      console.error("index_column query failed:", colRes.error);
      setLoading(false);
      return;
    }
    if (firstRes.error) {
      console.error("index_record first-chunk query failed:", firstRes.error);
      setLoading(false);
      return;
    }

    const colNames = ((colRes.data as { column_name: string }[] | null) ?? []).map((c) => c.column_name);
    const firstRows: Record<string, unknown>[] = (
      (firstRes.data as { id: number; data: Record<string, unknown> }[] | null) ?? []
    ).map((r) => ({ ...r.data, id: r.id }));

    const CHAR_PX = 8;
    const PADDING = 28;
    const MIN_W = 60;
    const MAX_W = 400;
    const CACHE_KEY = `index_col_widths_${projectId}`;

    const cached = localStorage.getItem(CACHE_KEY);
    let widthMap: Record<string, number>;

    if (cached) {
      widthMap = JSON.parse(cached);
    } else {
      // Sample widths from first chunk only — avoids O(N*M) blocking pass on 27k rows
      const maxLen: Record<string, number> = {};
      colNames.forEach((col) => {
        maxLen[col] = col.length;
      });
      for (const row of firstRows) {
        for (const col of colNames) {
          const len = row[col] != null ? String(row[col]).length : 0;
          if (len > (maxLen[col] ?? 0)) maxLen[col] = len;
        }
      }
      widthMap = {};
      for (const col of colNames) {
        widthMap[col] = Math.min(MAX_W, Math.max(MIN_W, (maxLen[col] ?? 0) * CHAR_PX + PADDING));
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(widthMap));
    }

    const cols: ColDef[] = colNames.map((col) => ({
      field: col,
      headerName: col,
      editable: true,
      sortable: true,
      width: widthMap[col] ?? 150,
    }));
    cols.unshift({
      field: "id",
      headerName: "ID",
      editable: false,
      sortable: true,
      width: 80,
      pinned: "left",
    } as ColDef);

    // Always place 1_TAG NUMBER immediately after ID, pinned left
    const tagNumIdx = cols.findIndex((c) => c.field === "1_TAG NUMBER");
    if (tagNumIdx !== -1) {
      const [tagNumCol] = cols.splice(tagNumIdx, 1);
      tagNumCol.pinned = "left";
      cols.splice(1, 0, tagNumCol);
    }

    type AuditRow = { record_id: number; column_name: string; change_reason: string | null; changed_at: string };
    const changedSet = new Set<string>();
    const infoMap = new Map<string, { reason: string | null; changedAt: string }>();
    for (const r of (auditRes.data as AuditRow[] | null) ?? []) {
      const key = `${r.record_id}_${r.column_name}`;
      changedSet.add(key);
      if (!infoMap.has(key)) {
        infoMap.set(key, { reason: r.change_reason, changedAt: r.changed_at });
      }
    }
    changedCellsRef.current = changedSet;
    changedCellsInfoRef.current = infoMap;
    setUncommittedCount(changedSet.size);

    setColumns(cols);
    setRowData(firstRows);
    setTotalRows(firstRows.length);
    setDisplayRowCount(firstRows.length);
    setLoading(false);

    // Phase 2: keyset-paginated streaming fetch. Each query is a pkey range scan
    // (`WHERE id > cursor LIMIT PAGE`) — no OFFSET cost, no statement_timeout risk,
    // and the UI gets incremental progress on every append.
    // applyTransaction instead of setRowData to avoid scroll reset on each chunk.
    if (firstRows.length >= PAGE) {
      setIsStreaming(true);
      let cursor = firstRows.length > 0 ? Math.max(...firstRows.map((r) => r.id as number)) : -1;
      let finalCount = firstRows.length;
      while (true) {
        if (myLoadId !== loadIdRef.current) return;
        const { data, error } = await idx
          .from("index_record")
          .select("id, data")
          .eq("project_id", projectId)
          .gt("id", cursor)
          .order("id")
          .limit(PAGE);
        if (myLoadId !== loadIdRef.current) return;
        if (error) {
          console.error(
            "index_record keyset fetch failed — code:", (error as any).code,
            "message:", (error as any).message,
            "details:", (error as any).details,
            "raw:", error,
          );
          break;
        }
        const rows = ((data as { id: number; data: Record<string, unknown> }[] | null) ?? []).map((r) => ({
          ...r.data,
          id: r.id,
        }));
        if (rows.length === 0) break;
        if (!gridApiRef.current || gridApiRef.current.isDestroyed()) return;
        gridApiRef.current.applyTransaction({ add: rows });
        finalCount += rows.length;
        setDisplayRowCount(finalCount);
        cursor = rows[rows.length - 1].id as number;
        if (rows.length < PAGE) break;
      }
      if (myLoadId !== loadIdRef.current) return;
      // totalRows를 한 번만 업데이트 — 스트리밍 중 청크마다 업데이트하면
      // paginationPageSize와 paginationPageSizeSelector가 서로 다른 값을 보는
      // AG Grid 경고가 매 청크마다 발생함
      setTotalRows(finalCount);
      setIsStreaming(false);
    }
  }, [idx, projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onCellValueChanged = (event: any) => {
    const { data, colDef, oldValue, newValue } = event;
    const fieldName = colDef.field;
    const recordId = data.id;
    if (oldValue === newValue || fieldName === "id") return;

    if (isUndoing.current) {
      isUndoing.current = false;
      return;
    }

    const key = `${recordId}_${fieldName}`;
    const existing = pendingChanges.current.get(key);
    undoStack.current.push({ recordId, fieldName, oldValue, rowNode: event.node });

    if (!existing) {
      pendingChanges.current.set(key, {
        recordId,
        fieldName,
        originalValue: oldValue,
        currentValue: newValue,
        rowNode: event.node,
      });
    } else {
      existing.currentValue = newValue;
    }
    setPendingCount(pendingChanges.current.size);
  };

  const handleUndo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) return;

    const key = `${last.recordId}_${last.fieldName}`;
    const pending = pendingChanges.current.get(key);
    if (pending) {
      if (pending.originalValue === last.oldValue) {
        pendingChanges.current.delete(key);
      } else {
        pending.currentValue = last.oldValue;
      }
      setPendingCount(pendingChanges.current.size);
    }

    isUndoing.current = true;
    last.rowNode.setDataValue(last.fieldName, last.oldValue);
  }, []);

  const saveChanges = async (reason: string) => {
    if (pendingChanges.current.size === 0) return;
    setIsSaving(true);

    const { data: { user } } = await baseSupabase.auth.getUser();
    const userId = user?.id ?? null;

    const allChanges = Array.from(pendingChanges.current.values());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordNodes = new Map<number, any>();
    for (const change of allChanges) {
      recordNodes.set(change.recordId, change.rowNode);
    }

    for (const [recordId, rowNode] of recordNodes) {
      const rowData = { ...rowNode.data };
      delete rowData.id;
      const { error } = await idx
        .from("index_record")
        .update({ data: rowData, is_committed: false })
        .eq("id", recordId)
        .eq("project_id", projectId);
      if (error) console.error(error);
    }

    const trimmedReason = reason.trim() || null;
    const savedAt = new Date().toISOString();
    for (const change of allChanges) {
      const tagNumber = change.rowNode.data["1_TAG NUMBER"] ?? null;
      await idx.from("index_audit_log").insert({
        project_id: projectId,
        record_id: change.recordId,
        tag_number: tagNumber != null ? String(tagNumber) : null,
        column_name: change.fieldName,
        old_value: change.originalValue != null ? String(change.originalValue) : null,
        new_value: change.currentValue != null ? String(change.currentValue) : null,
        changed_by: userId,
        committed: false,
        change_reason: trimmedReason,
      });
      const key = `${change.recordId}_${change.fieldName}`;
      changedCellsRef.current.add(key);
      changedCellsInfoRef.current.set(key, { reason: trimmedReason, changedAt: savedAt });
    }
    setUncommittedCount(changedCellsRef.current.size);

    pendingChanges.current.clear();
    undoStack.current = [];
    setPendingCount(0);
    setIsSaving(false);
    gridApiRef.current?.refreshCells({ force: true });
  };

  const exportExcel = async () => {
    const api = gridApiRef.current;
    if (!api) return;

    const filteredCols = columns.filter((c) => c.field && c.field !== "id");
    const columnKeys = filteredCols.map((c) => c.field as string);
    const headers = filteredCols.map((c) => (c.headerName ?? c.field) as string);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Master Index");

    ws.addRow(headers);
    ws.getRow(1).height = 30;
    ws.getRow(1).eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6B8E" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });

    const maxLen = headers.map((h) => h.length);
    api.forEachNodeAfterFilterAndSort((node) => {
      const recordId = node.data?.id as number | undefined;
      const vals = columnKeys.map((k, i) => {
        const v = node.data?.[k];
        const s = (v == null || v === "") ? null : String(v);
        if (s != null && s.length > maxLen[i]) maxLen[i] = s.length;
        return s;
      });
      const row = ws.addRow(vals);
      columnKeys.forEach((k, i) => {
        const key = recordId != null ? `${recordId}_${k}` : null;
        const isPending = key != null && pendingChanges.current.has(key);
        const isChanged = key != null && changedCellsRef.current.has(key);
        if (vals[i] != null || isPending || isChanged) {
          const cell = row.getCell(i + 1);
          cell.font = { name: "Calibri", size: 11 };
          if (isPending) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE68A" } };
          } else if (isChanged) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEFCE8" } };
          }
        }
      });
    });

    columnKeys.forEach((_, i) => { ws.getColumn(i + 1).width = Math.min(maxLen[i] + 2, 50); });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([new Uint8Array(buf as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Master_Index_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleSignOut = async () => {
    await baseSupabase.auth.signOut();
    window.location.assign('/login');
  };

  const handleTagAdded = (newRow: Record<string, unknown>) => {
    if (gridApiRef.current && !gridApiRef.current.isDestroyed()) {
      gridApiRef.current.applyTransaction({ add: [newRow] });
    }
    setDisplayRowCount((prev) => prev + 1);
    setTotalRows((prev) => prev + 1);
  };

  // Grid-scan helpers for AddTagPanel — always reads the live AG Grid store,
  // so they work even when rowData state only holds the first chunk.
  const checkTagExists = useCallback((tagCol: string, tag: string): boolean => {
    let found = false;
    gridApiRef.current?.forEachNode((node) => {
      if (!found && String(node.data?.[tagCol] ?? "").trim() === tag) found = true;
    });
    return found;
  }, []);

  const getLoopTagInfo = useCallback(
    (loopCol: string, loopOrdCol: string | undefined, loop: string): { count: number; maxOrder: number | null } => {
      let count = 0;
      let maxOrder: number | null = null;
      gridApiRef.current?.forEachNode((node) => {
        if (String(node.data?.[loopCol] ?? "").trim() !== loop) return;
        count++;
        if (!loopOrdCol) return;
        const ord = node.data?.[loopOrdCol];
        const num = typeof ord === "number" ? ord : parseInt(String(ord ?? ""), 10);
        if (!isNaN(num) && (maxOrder === null || num > maxOrder)) maxOrder = num;
      });
      return { count, maxOrder };
    },
    [],
  );

  const handleAddColumn = async () => {
    const name = newColumnName.trim().toUpperCase();
    if (!name) return;
    if (columns.some((c) => c.field === name)) {
      setAddColumnError("이미 존재하는 컬럼입니다.");
      return;
    }
    setIsAddingColumn(true);
    setAddColumnError("");
    const maxOrderIndex = columns.filter((c) => c.field !== "id").length;
    const { error } = await idx.from("index_column").insert({
      project_id: projectId,
      column_name: name,
      order_index: maxOrderIndex + 1,
    });
    if (error) {
      setAddColumnError(error.message);
      setIsAddingColumn(false);
      return;
    }
    const newCol: ColDef = { field: name, headerName: name, editable: true, sortable: true, width: 150 };
    setColumns((prev) => [...prev, newCol]);
    localStorage.removeItem(`index_col_widths_${projectId}`);
    setNewColumnName("");
    setShowAddColumnInput(false);
    setIsAddingColumn(false);
  };

  const handleDeleteColumn = (field: string) => {
    if (field === "id") return;
    const tagCol = columns.find((c) => c.field?.replace(/^\d+_/, "").toUpperCase() === "TAG NUMBER")?.field;
    if (field === tagCol) return;
    setDeleteColumnTarget(field);
  };

  const confirmDeleteColumn = async () => {
    if (!deleteColumnTarget) return;
    const field = deleteColumnTarget;
    setDeleteColumnTarget(null);
    const { error } = await idx
      .from("index_column")
      .delete()
      .eq("project_id", projectId)
      .eq("column_name", field);
    if (error) { console.error(error); return; }
    setColumns((prev) => prev.filter((c) => c.field !== field));
    setHiddenFields((prev) => { const next = new Set(prev); next.delete(field); return next; });
    localStorage.removeItem(`index_col_widths_${projectId}`);
  };

  const toggleColumn = (field: string) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const allFields = columns.map((c) => c.field as string).filter((f) => f !== "id");
  const filteredFields = allFields.filter((f) => f.toLowerCase().includes(columnSearch.toLowerCase()));
  const hiddenCount = hiddenFields.size;
  const visibleColumns = columns.map((c) => ({ ...c, hide: hiddenFields.has(c.field as string) }));

  const scrollToColumn = (field: string) => {
    const api = gridApiRef.current;
    if (!api) return;
    const col = api.getColumn(field);
    if (!col) return;

    // col.getLeft() is the absolute pixel position across ALL columns (including pinned).
    // The center viewport's scrollLeft is relative to its own start (after pinned cols),
    // so subtract the total pinned-left width to get the correct offset.
    const pinnedLeftWidth = api
      .getAllDisplayedColumns()
      .filter((c) => c.isPinnedLeft())
      .reduce((sum, c) => sum + c.getActualWidth(), 0);

    const scrollLeft = Math.max(0, (col.getLeft() ?? 0) - pinnedLeftWidth);

    // Drive scroll through AG Grid's fake horizontal scrollbar so that its
    // internal sync (center viewport + header) runs normally and pinned
    // columns stay in place.
    const hScroll = document.querySelector(
      ".ag-body-horizontal-scroll-viewport"
    ) as HTMLElement | null;
    if (hScroll) {
      hScroll.scrollLeft = scrollLeft;
    } else {
      // Fallback for when the scrollbar element isn't rendered (all cols fit on screen)
      const center = document.querySelector(".ag-center-cols-viewport") as HTMLElement | null;
      if (center) center.scrollLeft = scrollLeft;
    }
  };

  const handleColJumpChange = (q: string) => {
    setColJumpQuery(q);
    if (!q.trim()) { setColJumpMatches([]); setColJumpIdx(0); return; }
    const lq = q.toLowerCase();
    const matches = columns
      .map((c) => c.field as string)
      .filter((f) => f && f !== "id" && f.toLowerCase().includes(lq));
    setColJumpMatches(matches);
    setColJumpIdx(0);
    if (matches.length > 0) scrollToColumn(matches[0]);
  };

  const handleColJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (colJumpMatches.length === 0) return;
    if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = (colJumpIdx + 1) % colJumpMatches.length;
      setColJumpIdx(next);
      scrollToColumn(colJumpMatches[next]);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (colJumpIdx - 1 + colJumpMatches.length) % colJumpMatches.length;
      setColJumpIdx(prev);
      scrollToColumn(colJumpMatches[prev]);
    }
  };

  const btnBase =
    "flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200";

  return (
    <div className="flex flex-col h-screen bg-[#f7f4ef] dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700">
        <div className="flex items-center gap-3 flex-1 flex-wrap min-w-0">
          <h1 className="text-2xl font-bold text-[#000080] mr-1">
            GIDP Master Index
          </h1>
          {!loading && (
            <span className="text-sm text-gray-400 flex items-center gap-2">
              {isStreaming ? (
                <>
                  <Loader2 className="animate-spin text-blue-400" size={12} />
                  {displayRowCount.toLocaleString()} rows (loading…) · {allFields.length} columns
                </>
              ) : (
                <>
                  {displayRowCount.toLocaleString()} rows · {allFields.length} columns
                </>
              )}
            </span>
          )}

          {/* 컬럼 이름으로 이동 */}
          <div className="relative flex items-center">
            <ArrowLeftRight size={14} className="absolute left-3 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={colJumpQuery}
              onChange={(e) => handleColJumpChange(e.target.value)}
              onKeyDown={handleColJumpKeyDown}
              placeholder="컬럼 이동..."
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 outline-none focus:border-blue-400 w-36"
            />
            {colJumpMatches.length > 0 && (
              <span className="absolute right-2 text-xs text-gray-400 dark:text-slate-500 pointer-events-none">
                {colJumpIdx + 1}/{colJumpMatches.length}
              </span>
            )}
          </div>

          <button
            onClick={() => gridApiRef.current?.setFilterModel(null)}
            className={`${btnBase} hover:border-red-400 hover:text-red-500`}
          >
            <FilterX size={16} />
            Clear Filters
          </button>

          <div className="relative" ref={panelRef}>
            <button onClick={() => setShowColumnPanel((v) => !v)} className={`${btnBase} hover:border-blue-400`}>
              <Columns size={16} />
              Columns
              {hiddenCount > 0 && (
                <span className="bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {hiddenCount} hidden
                </span>
              )}
            </button>

            {showColumnPanel && (
              <div className="absolute left-0 top-10 z-50 w-80 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg p-3 flex flex-col gap-2">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide flex items-center gap-1">
                      <Star size={11} /> Favorites
                    </span>
                    <button
                      onClick={() => setShowSaveInput((v) => !v)}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                    >
                      <Plus size={12} /> Save current
                    </button>
                  </div>

                  {showSaveInput && (
                    <div className="flex gap-1 mb-1.5">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Favorite name..."
                        value={savingName}
                        onChange={(e) => setSavingName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveFavorite()}
                        className="flex-1 text-xs border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 outline-none bg-transparent dark:text-slate-200"
                      />
                      <button
                        onClick={saveFavorite}
                        className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded-md"
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {favorites.length > 0 ? (
                    <div className="space-y-0.5 mb-1">
                      {favorites.map((fav) => (
                        <div
                          key={fav.id}
                          className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 group"
                        >
                          <button
                            onClick={() => applyFavorite(fav)}
                            className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 flex-1 text-left"
                          >
                            <Star size={12} className="text-yellow-400 shrink-0" />
                            <span className="truncate">{fav.name}</span>
                            <span className="text-xs text-gray-400 shrink-0">
                              {fav.hiddenFields.length > 0
                                ? `${allFields.length - fav.hiddenFields.length} visible`
                                : "all visible"}
                            </span>
                          </button>
                          <button
                            onClick={() => deleteFavorite(fav)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-1"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-1 mb-1">No favorites yet</p>
                  )}
                </div>

                <div className="border-t border-gray-100 dark:border-slate-700 pt-2">
                  <div className="flex items-center gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 mb-2">
                    <Search size={14} className="text-gray-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search columns..."
                      value={columnSearch}
                      onChange={(e) => setColumnSearch(e.target.value)}
                      className="text-sm outline-none w-full bg-transparent dark:text-slate-200"
                    />
                  </div>

                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setHiddenFields(new Set())}
                      className="flex-1 text-xs py-1 rounded-md bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300"
                    >
                      Show all
                    </button>
                    <button
                      onClick={() => setHiddenFields(new Set(allFields))}
                      className="flex-1 text-xs py-1 rounded-md bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300"
                    >
                      Hide all
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {filteredFields.map((field) => {
                      const isTagCol = field.replace(/^\d+_/, "").toUpperCase() === "TAG NUMBER";
                      return (
                        <div
                          key={field}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 group"
                        >
                          <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={!hiddenFields.has(field)}
                              onChange={() => toggleColumn(field)}
                              className="accent-blue-500 shrink-0"
                            />
                            <span className="text-sm text-gray-700 dark:text-slate-300 truncate">{field}</span>
                          </label>
                          {!isTagCol && hasModuleAccess("Editor") && (
                            <button
                              onClick={() => canDeleteColumn && handleDeleteColumn(field)}
                              disabled={!canDeleteColumn}
                              className="opacity-0 group-hover:opacity-100 shrink-0 transition-opacity disabled:cursor-not-allowed disabled:text-gray-300 dark:disabled:text-slate-600 text-gray-400 hover:enabled:text-red-500"
                              title={canDeleteColumn ? "컬럼 삭제" : "Admin 또는 Project Admin만 삭제할 수 있습니다"}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {filteredFields.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">No columns found</p>
                    )}
                  </div>

                  {/* Add column */}
                  <div className="border-t border-gray-100 dark:border-slate-700 pt-2 mt-1">
                    {showAddColumnInput ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            type="text"
                            placeholder="New column name..."
                            value={newColumnName}
                            onChange={(e) => { setNewColumnName(e.target.value); setAddColumnError(""); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddColumn();
                              if (e.key === "Escape") { setShowAddColumnInput(false); setNewColumnName(""); setAddColumnError(""); }
                            }}
                            className="flex-1 text-xs border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 outline-none bg-transparent dark:text-slate-200 focus:border-blue-400"
                          />
                          <button
                            onClick={handleAddColumn}
                            disabled={isAddingColumn || !newColumnName.trim()}
                            className="text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white px-2 py-1 rounded-md flex items-center gap-1"
                          >
                            {isAddingColumn ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                            Add
                          </button>
                          <button
                            onClick={() => { setShowAddColumnInput(false); setNewColumnName(""); setAddColumnError(""); }}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 px-1"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {addColumnError && <p className="text-xs text-red-500">{addColumnError}</p>}
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddColumnInput(true)}
                        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                      >
                        <Plus size={12} /> Add Column
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddTag(true)}
            className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Tag size={16} />
            Add Tag
          </button>

          <button
            onClick={() =>
              window.open(
                `/index/changelog?projectId=${projectId}`,
                "changelog",
                "width=1400,height=750,resizable=yes,scrollbars=yes",
              )
            }
            className={`${btnBase} hover:border-purple-400`}
          >
            <History size={16} />
            Change Log
          </button>

          {pendingCount > 0 && (
            <button
              onClick={() => setShowSaveModal(true)}
              disabled={isSaving}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Changes
              <span className="bg-white/25 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {pendingCount}
              </span>
            </button>
          )}

        </div>

        {/* Right: user info + nav */}
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <button onClick={() => setDarkMode((v) => !v)} className={`${btnBase} hover:border-indigo-400`}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            {darkMode ? "Light" : "Dark"}
          </button>

          <button onClick={() => setShowUpload(true)} className={`${btnBase} hover:border-blue-400`}>
            <Upload size={16} />
            Upload
          </button>

          <button
            onClick={exportExcel}
            disabled={isStreaming || rowData.length === 0}
            title={isStreaming ? "데이터 로딩 중 — 완료 후 내보내기 가능" : undefined}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Download size={16} />
            Export to CSV
          </button>

          {userEmail && (
            <span className="hidden sm:inline text-gray-400 text-xs">
              {userEmail}
              <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                {moduleAccess}
              </span>
            </span>
          )}

          <a
            href="/"
            className={`${btnBase} hover:border-blue-400`}
            title="GIDP Dashboard"
          >
            <Home size={16} />
          </a>

          <a
            href="/project"
            className={`${btnBase} hover:border-blue-400`}
            title="프로젝트 전환"
          >
            <FolderKanban size={16} />
            <span className="max-w-32 truncate">{projectName || "Project"}</span>
          </a>

          <button onClick={handleSignOut} className={`${btnBase} hover:border-red-400 hover:text-red-500`}>
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>

      {/* Grid Area */}
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="animate-spin text-blue-500" size={32} />
              <p className="text-sm text-gray-500 font-medium">Loading data from cloud...</p>
            </div>
          </div>
        ) : null}

        {columns.length > 0 ? (
          <DataGrid
            columns={visibleColumns}
            rowData={rowData}
            totalRows={totalRows}
            onCellValueChanged={onCellValueChanged}
            onGridReady={(api) => {
              gridApiRef.current = api;
            }}
            isChangedCell={(recordId, colName) => changedCellsRef.current.has(`${recordId}_${colName}`)}
            getChangedCellTooltip={(recordId, colName) => {
              const info = changedCellsInfoRef.current.get(`${recordId}_${colName}`);
              if (!info) return undefined;
              const date = new Date(info.changedAt).toLocaleDateString("ko-KR");
              return info.reason ? `변경 이유: ${info.reason}\n변경일: ${date}` : `변경일: ${date}`;
            }}
            onUndo={handleUndo}
          />
        ) : (
          !loading && <div className="w-full h-full flex items-center justify-center text-gray-400">No data available</div>
        )}
      </div>

      <UploadModal
        open={showUpload}
        projectId={projectId}
        onClose={() => setShowUpload(false)}
        onUploadComplete={loadData}
      />
      <AddTagPanel
        open={showAddTag}
        projectId={projectId}
        columnFields={allFields}
        isStreaming={isStreaming}
        checkTagExists={checkTagExists}
        getLoopTagInfo={getLoopTagInfo}
        onClose={() => setShowAddTag(false)}
        onTagAdded={handleTagAdded}
      />

      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <Save size={18} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">변경 사항 저장</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                  {pendingCount}개 셀의 변경 내용을 저장합니다.
                </p>
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                변경 사유 <span className="text-gray-400 dark:text-slate-500 font-normal">(선택)</span>
              </label>
              <input
                type="text"
                autoFocus
                placeholder="예: 현장 검토 후 태그번호 수정"
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSaving) {
                    setShowSaveModal(false);
                    saveChanges(saveReason).then(() => setSaveReason(""));
                  } else if (e.key === "Escape") {
                    setShowSaveModal(false);
                    setSaveReason("");
                  }
                }}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-400 bg-white dark:bg-slate-700 dark:text-slate-200 placeholder-gray-400"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowSaveModal(false); setSaveReason(""); }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  saveChanges(saveReason).then(() => setSaveReason(""));
                }}
                disabled={isSaving}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-medium transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteColumnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <Trash2 size={18} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">칼럼 삭제</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                  이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
            </div>
            <div className="mb-5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <span className="font-medium break-all">&ldquo;{deleteColumnTarget}&rdquo;</span> 칼럼이 DB에서 영구 삭제됩니다.
              기존 레코드에 입력된 해당 칼럼의 데이터도 함께 삭제됩니다.
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteColumnTarget(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmDeleteColumn}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
