"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Loader2, Search, GitCommit } from "lucide-react";
import { supabase } from "./supabase";

interface AuditLog {
  id: number;
  record_id: number;
  tag_number: string | null;
  column_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
  commit_description: string | null;
}

interface ChangeLogPanelProps {
  open: boolean;
  onClose: () => void;
  uncommittedCount: number;
  onCommit: (description: string) => Promise<void>;
}

const PAGE_SIZE = 50;

export default function ChangeLogPanel({ open, onClose, uncommittedCount, onCommit }: ChangeLogPanelProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterTagNumber, setFilterTagNumber] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [commitDesc, setCommitDesc] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  const fetchLogs = useCallback(async (currentPage: number, tagNumber: string, column: string) => {
    setLoading(true);
    let query = supabase
      .from("index_audit_logs")
      .select("*", { count: "exact" })
      .order("changed_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (tagNumber.trim()) query = query.ilike("tag_number", `%${tagNumber.trim()}%`);
    if (column.trim()) query = query.ilike("column_name", `%${column.trim()}%`);

    const { data, count, error } = await query;
    if (!error) {
      setLogs(data ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setPage(0);
    fetchLogs(0, filterTagNumber, filterColumn);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
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
    await onCommit(commitDesc);
    setCommitDesc("");
    setIsCommitting(false);
    // Refresh logs after commit
    setPage(0);
    fetchLogs(0, filterTagNumber, filterColumn);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700 shrink-0">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Change Log</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        {/* Commit Section */}
        {uncommittedCount > 0 && (
          <div className="flex items-center gap-3 px-6 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700 shrink-0">
            <GitCommit size={16} className="text-amber-500 shrink-0" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400 shrink-0">
              {uncommittedCount} cell{uncommittedCount > 1 ? "s" : ""} changed since last commit
            </span>
            <input
              type="text"
              placeholder="Commit description (reason for changes)..."
              value={commitDesc}
              onChange={(e) => setCommitDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isCommitting && handleCommit()}
              className="flex-1 text-sm border border-amber-300 dark:border-amber-600 rounded-lg px-3 py-1.5 outline-none bg-white dark:bg-slate-700 dark:text-slate-200 placeholder-gray-400"
            />
            <button
              onClick={handleCommit}
              disabled={isCommitting}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              {isCommitting ? <Loader2 size={14} className="animate-spin" /> : <GitCommit size={14} />}
              Commit
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 px-6 py-3 border-b border-gray-100 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 w-52">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Tag Number..."
              value={filterTagNumber}
              onChange={(e) => setFilterTagNumber(e.target.value)}
              className="text-sm outline-none w-full bg-transparent dark:text-slate-200"
            />
          </div>
          <div className="flex items-center gap-2 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 w-64">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Column name..."
              value={filterColumn}
              onChange={(e) => setFilterColumn(e.target.value)}
              className="text-sm outline-none w-full bg-transparent dark:text-slate-200"
            />
          </div>
          {total > 0 && (
            <span className="ml-auto text-sm text-gray-400 dark:text-slate-500 self-center">
              {total.toLocaleString()} records
            </span>
          )}
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
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 dark:bg-slate-700 z-10">
                <tr>
                  {["Changed At", "Tag Number", "Column", "Old Value", "New Value", "Commit Description", "Changed By"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 border-b border-gray-200 dark:border-slate-600 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 text-xs">{formatDate(log.changed_at)}</td>
                    <td className="px-4 py-2 text-gray-700 dark:text-slate-300 font-mono text-xs whitespace-nowrap">{log.tag_number ?? <span className="text-gray-300 dark:text-slate-600">—</span>}</td>
                    <td className="px-4 py-2 max-w-[160px]">
                      <span className="block truncate font-mono text-xs text-blue-600 dark:text-blue-400" title={log.column_name}>
                        {log.column_name}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-[180px]">
                      <span className="block truncate text-red-500 dark:text-red-400 text-xs" title={log.old_value ?? ""}>
                        {log.old_value ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-[180px]">
                      <span className="block truncate text-emerald-600 dark:text-emerald-400 text-xs" title={log.new_value ?? ""}>
                        {log.new_value ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-[200px]">
                      <span className="block truncate text-gray-500 dark:text-slate-400 text-xs italic" title={log.commit_description ?? ""}>
                        {log.commit_description ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap">{log.changed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-gray-100 dark:border-slate-700 shrink-0">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 0}
              className="px-3 py-1 text-sm rounded-md border border-gray-200 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-sm rounded-md border border-gray-200 dark:border-slate-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
