"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Loader2, Search, GitCommit } from "lucide-react";
import { createClient } from "@/lib/supabase-client";

interface AuditLog {
  id: number;
  record_id: number | null;
  tag_number: string | null;
  column_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
  commit_description: string | null;
}

const COLUMNS = [
  { key: "changed_at",         label: "Changed At",         defaultWidth: 155 },
  { key: "tag_number",         label: "Tag Number",         defaultWidth: 120 },
  { key: "column_name",        label: "Column",             defaultWidth: 160 },
  { key: "old_value",          label: "Old Value",          defaultWidth: 180 },
  { key: "new_value",          label: "New Value",          defaultWidth: 180 },
  { key: "change_reason",      label: "Change Reason",      defaultWidth: 180 },
  { key: "commit_description", label: "Commit Description", defaultWidth: 180 },
  { key: "changed_by",         label: "Changed By",         defaultWidth: 140 },
] as const;

type ColKey = (typeof COLUMNS)[number]["key"];

const PAGE_SIZE = 50;

export default function ChangeLogWindow({ projectId }: { projectId: number }) {
  const supabase = useMemo(() => createClient(), []);
  const idx = useMemo(() => supabase.schema("idx"), [supabase]);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterTagNumber, setFilterTagNumber] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [commitDesc, setCommitDesc] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [uncommittedCount, setUncommittedCount] = useState(0);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());

  const initialWidths = useMemo(
    () => Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>,
    [],
  );
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(initialWidths);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  const tableWidth = COLUMNS.reduce((s, c) => s + colWidths[c.key], 0);

  const fetchLogs = useCallback(
    async (currentPage: number, tagNumber: string, column: string) => {
      setLoading(true);

      let query = idx
        .from("index_audit_log")
        .select("*", { count: "exact" })
        .eq("project_id", projectId)
        .order("changed_at", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (tagNumber.trim()) query = query.ilike("tag_number", `%${tagNumber.trim()}%`);
      if (column.trim()) query = query.ilike("column_name", `%${column.trim()}%`);

      const [{ data, count, error }, { count: uncommitted }] = await Promise.all([
        query,
        idx
          .from("index_audit_log")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("committed", false),
      ]);

      if (!error && data) {
        const rows = data as AuditLog[];
        setLogs(rows);
        setTotal(count ?? 0);
        setUncommittedCount(uncommitted ?? 0);

        const distinctIds = [
          ...new Set(rows.map((r) => r.changed_by).filter(Boolean)),
        ] as string[];
        if (distinctIds.length > 0) {
          const { data: profiles } = await supabase
            .from("user_profile")
            .select("id, display_name, email")
            .in("id", distinctIds);
          if (profiles) {
            setUserNames((prev) => {
              const next = new Map(prev);
              for (const p of profiles as { id: string; display_name: string | null; email: string }[]) {
                next.set(p.id, p.display_name || p.email);
              }
              return next;
            });
          }
        }
      }
      setLoading(false);
    },
    [projectId, idx, supabase],
  );

  useEffect(() => {
    fetchLogs(0, "", "");
  }, [fetchLogs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      fetchLogs(0, filterTagNumber, filterColumn);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterTagNumber, filterColumn]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToPage = (p: number) => {
    setPage(p);
    fetchLogs(p, filterTagNumber, filterColumn);
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    const { error } = await idx
      .from("index_audit_log")
      .update({ committed: true, commit_description: commitDesc.trim() || null })
      .eq("project_id", projectId)
      .eq("committed", false);
    if (!error) {
      await idx
        .from("index_record")
        .update({ is_committed: true })
        .eq("project_id", projectId)
        .eq("is_committed", false);
    }
    setCommitDesc("");
    setIsCommitting(false);
    setPage(0);
    fetchLogs(0, filterTagNumber, filterColumn);
  };

  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidthsRef.current[col];

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setColWidths((prev) => ({
        ...prev,
        [col]: Math.max(60, startWidth + delta),
      }));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Change Log</h1>
        {total > 0 && (
          <span className="text-xs text-gray-400 dark:text-slate-500">{total.toLocaleString()} records</span>
        )}
      </div>

      {/* Commit bar */}
      {uncommittedCount > 0 && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700 shrink-0">
          <GitCommit size={15} className="text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
            {uncommittedCount} cell{uncommittedCount !== 1 ? "s" : ""} changed since last commit
          </span>
          <input
            type="text"
            placeholder="Commit description..."
            value={commitDesc}
            onChange={(e) => setCommitDesc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isCommitting && handleCommit()}
            className="flex-1 text-xs border border-amber-300 dark:border-amber-600 rounded-lg px-3 py-1.5 outline-none bg-white dark:bg-slate-700 dark:text-slate-200 placeholder-gray-400"
          />
          <button
            onClick={handleCommit}
            disabled={isCommitting}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >
            {isCommitting ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
            Commit
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 px-5 py-2.5 border-b border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 w-48">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Tag Number..."
            value={filterTagNumber}
            onChange={(e) => setFilterTagNumber(e.target.value)}
            className="text-xs outline-none w-full bg-transparent dark:text-slate-200"
          />
        </div>
        <div className="flex items-center gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 w-56">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Column name..."
            value={filterColumn}
            onChange={(e) => setFilterColumn(e.target.value)}
            className="text-xs outline-none w-full bg-transparent dark:text-slate-200"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="animate-spin text-blue-500" size={28} />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 dark:text-slate-500 text-sm">
            No change logs found
          </div>
        ) : (
          <table
            className="text-sm border-collapse"
            style={{ tableLayout: "fixed", width: tableWidth, minWidth: "100%" }}
          >
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 bg-gray-50 dark:bg-slate-700 z-10">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-slate-300 border-b border-gray-200 dark:border-slate-600 whitespace-nowrap select-none relative"
                    style={{ width: colWidths[col.key] }}
                  >
                    <span className="block pr-2 truncate text-xs">{col.label}</span>
                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 h-full w-2 cursor-col-resize group"
                      onMouseDown={(e) => startResize(col.key, e)}
                    >
                      <div className="absolute right-0 top-1 bottom-1 w-px bg-gray-300 dark:bg-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-gray-100 dark:border-slate-700 hover:bg-blue-50/40 dark:hover:bg-slate-700/40"
                >
                  <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap overflow-hidden text-ellipsis">
                    {formatDate(log.changed_at)}
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate font-mono text-xs text-gray-700 dark:text-slate-300" title={log.tag_number ?? ""}>
                      {log.tag_number ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate font-mono text-xs text-blue-600 dark:text-blue-400" title={log.column_name}>
                      {log.column_name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate text-xs text-red-500 dark:text-red-400" title={log.old_value ?? ""}>
                      {log.old_value ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate text-xs text-emerald-600 dark:text-emerald-400" title={log.new_value ?? ""}>
                      {log.new_value ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate text-xs text-violet-600 dark:text-violet-400" title={log.change_reason ?? ""}>
                      {log.change_reason ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate text-xs text-gray-500 dark:text-slate-400 italic" title={log.commit_description ?? ""}>
                      {log.commit_description ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 overflow-hidden">
                    <span className="block truncate text-xs text-gray-500 dark:text-slate-400" title={log.changed_by ?? ""}>
                      {log.changed_by
                        ? (userNames.get(log.changed_by) ?? log.changed_by.slice(0, 8))
                        : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-5 py-2.5 border-t border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0}
            className="px-3 py-1 text-xs rounded-md border border-gray-200 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-xs rounded-md border border-gray-200 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
