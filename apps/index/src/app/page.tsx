"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Download, Upload, Columns, Loader2, Search, FilterX, Moon, Sun, Star, Trash2, Plus, History, Save } from "lucide-react";
import type { ColDef, GridApi } from "ag-grid-community";
import { supabase } from "./supabase";
import UploadModal from "./UploadModal";
import ChangeLogPanel from "./ChangeLogPanel";

const DataGrid = dynamic(() => import("./DataGrid"), { ssr: false });

interface Favorite {
  name: string;
  hiddenFields: string[];
}

interface PendingChange {
  recordId: number;
  fieldName: string;
  originalValue: any;
  currentValue: any;
  rowNode: any;
}

interface UndoEntry {
  recordId: number;
  fieldName: string;
  oldValue: any;
  rowNode: any;
}

export default function Home() {
  const [columns, setColumns] = useState<ColDef[]>([]);
  const [rowData, setRowData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
  const [showChangeLog, setShowChangeLog] = useState(false);

  const changedCellsRef = useRef<Set<string>>(new Set());
  const [uncommittedCount, setUncommittedCount] = useState(0);

  // Pending changes & undo
  const pendingChanges = useRef<Map<string, PendingChange>>(new Map());
  const undoStack = useRef<UndoEntry[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const isUndoing = useRef(false);

  // Load favorites from Supabase
  useEffect(() => {
    supabase.from("index_favorites").select("name, hidden_fields").order("created_at")
      .then(({ data }) => {
        if (data) setFavorites(data.map((r) => ({ name: r.name, hiddenFields: r.hidden_fields })));
      });
  }, []);

  const saveFavorite = async () => {
    const name = savingName.trim();
    if (!name) return;
    const hidden = Array.from(hiddenFields);
    await supabase.from("index_favorites").upsert({ name, hidden_fields: hidden }, { onConflict: "name" });
    const updated = [...favorites.filter((f) => f.name !== name), { name, hiddenFields: hidden }];
    setFavorites(updated);
    setSavingName("");
    setShowSaveInput(false);
  };

  const applyFavorite = (fav: Favorite) => {
    setHiddenFields(new Set(fav.hiddenFields));
  };

  const deleteFavorite = async (name: string) => {
    await supabase.from("index_favorites").delete().eq("name", name);
    setFavorites((prev) => prev.filter((f) => f.name !== name));
  };

  // Dark mode toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // Close panel when clicking outside
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

  // Load data from Supabase
  const loadData = useCallback(async () => {
    setLoading(true);
    setHiddenFields(new Set());
    pendingChanges.current.clear();
    undoStack.current = [];
    setPendingCount(0);

    const { data: colData, error: colError } = await supabase
      .from("index_columns")
      .select("column_name, order_index")
      .order("order_index");

    if (colError) { console.error(colError); setLoading(false); return; }

    const colNames = (colData ?? []).map((c) => c.column_name as string);

    const PAGE = 1000;
    let allRows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase.from("index_records").select("id, data").range(from, from + PAGE - 1).order("id");
      if (error?.message) { console.error(error); break; }
      if (!data || data.length === 0) break;
      // id를 마지막에 덮어써서 JSONB 내 id 필드에 의해 덮어쓰이지 않도록 함
      allRows = allRows.concat(data.map((r) => ({ ...r.data, id: r.id })));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const CHAR_PX = 8;
    const PADDING = 28;
    const MIN_W = 60;
    const MAX_W = 400;
    const CACHE_KEY = "index_col_widths";

    const cached = localStorage.getItem(CACHE_KEY);
    let widthMap: Record<string, number>;

    if (cached) {
      widthMap = JSON.parse(cached);
    } else {
      const maxLen: Record<string, number> = {};
      colNames.forEach((col) => { maxLen[col] = col.length; });
      for (const row of allRows) {
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
      filter: true,
      sortable: true,
      width: widthMap[col] ?? 150,
    }));
    cols.unshift({ field: "id", headerName: "ID", editable: false, filter: true, sortable: true, width: 80, pinned: "left" } as any);
    setColumns(cols);
    setRowData(allRows);

    // Load uncommitted changed cells from audit log (paginated)
    const changedSet = new Set<string>();
    let auditFrom = 0;
    while (true) {
      const { data: auditChunk } = await supabase
        .from("index_audit_logs")
        .select("record_id, column_name")
        .eq("committed", false)
        .range(auditFrom, auditFrom + 999);
      if (!auditChunk || auditChunk.length === 0) break;
      for (const r of auditChunk) changedSet.add(`${r.record_id}_${r.column_name}`);
      if (auditChunk.length < 1000) break;
      auditFrom += 1000;
    }
    changedCellsRef.current = changedSet;
    setUncommittedCount(changedSet.size);

    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Buffer edits — don't save to DB immediately
  const onCellValueChanged = (event: any) => {
    const { data, colDef, oldValue, newValue } = event;
    const fieldName = colDef.field;
    const recordId = data.id;
    if (oldValue === newValue || fieldName === "id") return;

    // Triggered by undo — skip pushing to undoStack
    if (isUndoing.current) {
      isUndoing.current = false;
      return;
    }

    const key = `${recordId}_${fieldName}`;
    const existing = pendingChanges.current.get(key);
    undoStack.current.push({ recordId, fieldName, oldValue, rowNode: event.node });

    if (!existing) {
      pendingChanges.current.set(key, { recordId, fieldName, originalValue: oldValue, currentValue: newValue, rowNode: event.node });
    } else {
      existing.currentValue = newValue;
    }
    setPendingCount(pendingChanges.current.size);
  };

  // Undo last edit (Ctrl+Z)
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


  // Commit: mark current state as new baseline (clear yellow highlights)
  const handleCommit = async (description: string) => {
    const { error } = await supabase
      .from("index_audit_logs")
      .update({ committed: true, commit_description: description.trim() || null })
      .eq("committed", false);
    if (!error) {
      changedCellsRef.current.clear();
      setUncommittedCount(0);
      gridApiRef.current?.refreshCells({ force: true });
    }
  };

  // Save all pending changes to DB
  const saveChanges = async () => {
    if (pendingChanges.current.size === 0) return;
    setIsSaving(true);

    const allChanges = Array.from(pendingChanges.current.values());

    // Group by recordId — save each record once with all pending edits
    const recordNodes = new Map<number, any>();
    for (const change of allChanges) {
      recordNodes.set(change.recordId, change.rowNode);
    }

    for (const [recordId, rowNode] of recordNodes) {
      const rowData = { ...rowNode.data };
      delete rowData.id;
      const { error } = await supabase.from("index_records").update({ data: rowData }).eq("id", recordId);
      if (error) console.error(error);
    }

    // Insert audit log entries (committed=false — baseline not yet set)
    for (const change of allChanges) {
      const tagNumber = change.rowNode.data["1_TAG NUMBER"] ?? null;
      await supabase.from("index_audit_logs").insert({
        record_id: change.recordId,
        tag_number: tagNumber != null ? String(tagNumber) : null,
        column_name: change.fieldName,
        old_value: change.originalValue != null ? String(change.originalValue) : null,
        new_value: change.currentValue != null ? String(change.currentValue) : null,
        changed_by: "User",
        committed: false,
      });
      changedCellsRef.current.add(`${change.recordId}_${change.fieldName}`);
    }
    setUncommittedCount(changedCellsRef.current.size);

    pendingChanges.current.clear();
    undoStack.current = [];
    setPendingCount(0);
    setIsSaving(false);
    gridApiRef.current?.refreshCells({ force: true });
  };

  const exportExcel = async () => {
    const { data, error } = await supabase.from("index_records").select("data").order("id");
    if (error || !data) return;
    const colNames = columns.filter((c) => c.field !== "id").map((c) => c.field as string);
    const rows = data.map((r) => { const obj: any = {}; colNames.forEach((col) => { obj[col] = r.data[col] ?? null; }); return obj; });
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows, { header: colNames });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Index");
    XLSX.writeFile(wb, "Master_Index_export.xlsx");
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

  const btnBase = "flex items-center gap-2 border px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200";

  return (
    <div className="flex flex-col h-screen bg-[#f7f4ef] dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            GIDP Master Index
          </h1>
          {!loading && (
            <span className="text-sm text-gray-400">
              {rowData.length.toLocaleString()} rows · {allFields.length} columns
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Dark Mode */}
          <button onClick={() => setDarkMode((v) => !v)} className={`${btnBase} hover:border-indigo-400`}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            {darkMode ? "Light" : "Dark"}
          </button>

          {/* Clear Filters */}
          <button onClick={() => gridApiRef.current?.setFilterModel(null)} className={`${btnBase} hover:border-red-400 hover:text-red-500`}>
            <FilterX size={16} />
            Clear Filters
          </button>

          {/* Columns Panel */}
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
              <div className="absolute right-0 top-10 z-50 w-80 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg p-3 flex flex-col gap-2">

                {/* Favorites Section */}
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

                  {/* Save input */}
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

                  {/* Favorites list */}
                  {favorites.length > 0 ? (
                    <div className="space-y-0.5 mb-1">
                      {favorites.map((fav) => (
                        <div key={fav.name} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 group">
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
                            onClick={() => deleteFavorite(fav.name)}
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
                  {/* Search */}
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

                  {/* Show/Hide all */}
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => setHiddenFields(new Set())} className="flex-1 text-xs py-1 rounded-md bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300">
                      Show all
                    </button>
                    <button onClick={() => setHiddenFields(new Set(allFields))} className="flex-1 text-xs py-1 rounded-md bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300">
                      Hide all
                    </button>
                  </div>

                  {/* Column list */}
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {filteredFields.map((field) => (
                      <label key={field} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
                        <input type="checkbox" checked={!hiddenFields.has(field)} onChange={() => toggleColumn(field)} className="accent-blue-500" />
                        <span className="text-sm text-gray-700 dark:text-slate-300 truncate">{field}</span>
                      </label>
                    ))}
                    {filteredFields.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">No columns found</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button onClick={() => setShowChangeLog(true)} className={`${btnBase} hover:border-purple-400`}>
            <History size={16} />
            Change Log
          </button>

          <button onClick={() => setShowUpload(true)} className={`${btnBase} hover:border-blue-400`}>
            <Upload size={16} />
            Upload
          </button>

          {/* Save Changes */}
          {pendingCount > 0 && (
            <button
              onClick={() => saveChanges()}
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

          <button onClick={exportExcel} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Download size={16} />
            Export to Excel
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
          <DataGrid columns={visibleColumns} rowData={rowData} onCellValueChanged={onCellValueChanged} onGridReady={(api) => { gridApiRef.current = api; }} isChangedCell={(recordId, colName) => changedCellsRef.current.has(`${recordId}_${colName}`)} onUndo={handleUndo} />
        ) : (
          !loading && <div className="w-full h-full flex items-center justify-center text-gray-400">No data available</div>
        )}
      </div>

      <UploadModal open={showUpload} onClose={() => setShowUpload(false)} onUploadComplete={loadData} />
      <ChangeLogPanel open={showChangeLog} onClose={() => setShowChangeLog(false)} uncommittedCount={uncommittedCount} onCommit={handleCommit} />
    </div>
  );
}
