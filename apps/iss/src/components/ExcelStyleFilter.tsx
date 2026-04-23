"use client";

import {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { IFilterParams, IDoesFilterPassParams } from "ag-grid-community";

const UNIQUE_LIMIT = 500;
const DISPLAY_BLANK = "(Blanks)";

type Operator = "contains" | "not_contains" | "equals" | "not_equals" | "starts" | "ends";
type Logic = "AND" | "OR";

interface Condition {
  op: Operator;
  value: string;
}

export interface ExcelFilterModel {
  cond1: Condition;
  cond2: Condition;
  logic: Logic;
  selectedValues: string[] | null; // null = all selected
}

const OP_LABELS: Record<Operator, string> = {
  contains:     "포함",
  not_contains: "포함하지 않음",
  equals:       "같음",
  not_equals:   "같지 않음",
  starts:       "시작",
  ends:         "끝",
};

const DEFAULT_COND: Condition = { op: "contains", value: "" };

function applyOp(cellVal: string, cond: Condition): boolean {
  const v = cellVal.toLowerCase();
  const t = cond.value.toLowerCase();
  switch (cond.op) {
    case "contains":     return v.includes(t);
    case "not_contains": return !v.includes(t);
    case "equals":       return v === t;
    case "not_equals":   return v !== t;
    case "starts":       return v.startsWith(t);
    case "ends":         return v.endsWith(t);
  }
}

function matchesTextFilter(
  cellVal: string,
  cond1: Condition,
  cond2: Condition,
  logic: Logic
): boolean {
  const a1 = cond1.value !== "";
  const a2 = cond2.value !== "";
  if (!a1 && !a2) return true;
  if (a1 && !a2) return applyOp(cellVal, cond1);
  if (!a1 && a2) return applyOp(cellVal, cond2);
  return logic === "AND"
    ? applyOp(cellVal, cond1) && applyOp(cellVal, cond2)
    : applyOp(cellVal, cond1) || applyOp(cellVal, cond2);
}

function displayStr(raw: unknown): string {
  return raw == null ? DISPLAY_BLANK : String(raw);
}

// ── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  flex: 1, padding: "4px 7px",
  border: "1px solid #d1d5db", borderRadius: 4,
  fontSize: 12, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit", minWidth: 0,
};

const selectStyle: React.CSSProperties = {
  padding: "4px 4px", border: "1px solid #d1d5db", borderRadius: 4,
  fontSize: 11, outline: "none", fontFamily: "inherit",
  backgroundColor: "#f9fafb", cursor: "pointer", flexShrink: 0,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#6b7280",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
};

// ── Component ──────────────────────────────────────────────────────────────

const ExcelStyleFilter = forwardRef(function ExcelStyleFilter(
  props: IFilterParams,
  ref
) {
  const field = props.colDef.field as string;

  // ── Pending UI state (not yet applied) ──
  const [cond1, setCond1] = useState<Condition>({ ...DEFAULT_COND });
  const [cond2, setCond2] = useState<Condition>({ ...DEFAULT_COND });
  const [logic, setLogic] = useState<Logic>("AND");
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [uniqueValues, setUniqueValues] = useState<string[]>([]);
  const [tooMany, setTooMany] = useState(false);

  // ── Applied state (what doesFilterPass actually uses) ──
  // null selectedValues = all selected (no checkbox filter)
  const appliedCond1 = useRef<Condition>({ ...DEFAULT_COND });
  const appliedCond2 = useRef<Condition>({ ...DEFAULT_COND });
  const appliedLogic = useRef<Logic>("AND");
  const appliedSelected = useRef<Set<string> | null>(null); // null = all
  const uniqueValuesRef = useRef<string[]>([]);
  const tooManyRef = useRef(false);

  // ── Unique values ───────────────────────────────────────────────────────

  const computeUniqueValues = useCallback(() => {
    const seen = new Set<string>();
    let overflow = false;
    props.api.forEachNode((node) => {
      if (overflow) return;
      seen.add(displayStr(node.data?.[field]));
      if (seen.size > UNIQUE_LIMIT) overflow = true;
    });

    if (overflow) {
      setTooMany(true);
      tooManyRef.current = true;
      return;
    }

    const sorted = Array.from(seen).sort((a, b) => {
      if (a === DISPLAY_BLANK) return 1;
      if (b === DISPLAY_BLANK) return -1;
      return a.localeCompare(b);
    });

    setTooMany(false);
    tooManyRef.current = false;
    setUniqueValues(sorted);
    uniqueValuesRef.current = sorted;

    // Restore pending checkboxes from applied state
    const applied = appliedSelected.current;
    setSelectedValues(applied !== null ? new Set(applied) : new Set(sorted));
  }, [props.api, field]);

  useEffect(() => { computeUniqueValues(); }, [computeUniqueValues]);

  // ── Filter interface ────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    isFilterActive() {
      if (appliedCond1.current.value !== "") return true;
      if (appliedCond2.current.value !== "") return true;
      if (appliedSelected.current !== null) return true;
      return false;
    },

    doesFilterPass(params: IDoesFilterPassParams) {
      const raw = params.data?.[field];
      const cellVal = raw == null ? "" : String(raw);
      const dispVal = displayStr(raw);

      if (!matchesTextFilter(cellVal, appliedCond1.current, appliedCond2.current, appliedLogic.current)) {
        return false;
      }
      const sv = appliedSelected.current;
      if (!tooManyRef.current && sv !== null && !sv.has(dispVal)) {
        return false;
      }
      return true;
    },

    getModel(): ExcelFilterModel | null {
      const isTextActive = appliedCond1.current.value !== "" || appliedCond2.current.value !== "";
      const isCheckboxActive = appliedSelected.current !== null;
      if (!isTextActive && !isCheckboxActive) return null;
      return {
        cond1: { ...appliedCond1.current },
        cond2: { ...appliedCond2.current },
        logic: appliedLogic.current,
        selectedValues: appliedSelected.current ? Array.from(appliedSelected.current) : null,
      };
    },

    // Called by "Clear Filters" in the top bar — resets everything immediately
    setModel(model: ExcelFilterModel | null) {
      if (!model) {
        appliedCond1.current = { ...DEFAULT_COND };
        appliedCond2.current = { ...DEFAULT_COND };
        appliedLogic.current = "AND";
        appliedSelected.current = null;
        setCond1({ ...DEFAULT_COND });
        setCond2({ ...DEFAULT_COND });
        setLogic("AND");
        setSelectedValues(new Set(uniqueValuesRef.current));
      } else {
        appliedCond1.current = model.cond1 ?? { ...DEFAULT_COND };
        appliedCond2.current = model.cond2 ?? { ...DEFAULT_COND };
        appliedLogic.current = model.logic ?? "AND";
        appliedSelected.current = model.selectedValues ? new Set(model.selectedValues) : null;
        setCond1(appliedCond1.current);
        setCond2(appliedCond2.current);
        setLogic(appliedLogic.current);
        setSelectedValues(appliedSelected.current ?? new Set(uniqueValuesRef.current));
      }
      props.filterChangedCallback();
    },

    // Restore pending UI to match applied state when panel opens
    afterGuiAttached() {
      computeUniqueValues(); // also restores pending checkboxes
      setCond1({ ...appliedCond1.current });
      setCond2({ ...appliedCond2.current });
      setLogic(appliedLogic.current);
    },
  }));

  // ── Buttons ─────────────────────────────────────────────────────────────

  const handleApply = () => {
    appliedCond1.current = { ...cond1 };
    appliedCond2.current = { ...cond2 };
    appliedLogic.current = logic;

    // null if all values are selected (no checkbox filter needed)
    const allSelected = uniqueValuesRef.current.every((v) => selectedValues.has(v));
    appliedSelected.current = !tooManyRef.current && !allSelected
      ? new Set(selectedValues)
      : null;

    props.filterChangedCallback();
  };

  const handleClear = () => {
    appliedCond1.current = { ...DEFAULT_COND };
    appliedCond2.current = { ...DEFAULT_COND };
    appliedLogic.current = "AND";
    appliedSelected.current = null;
    setCond1({ ...DEFAULT_COND });
    setCond2({ ...DEFAULT_COND });
    setLogic("AND");
    setSelectedValues(new Set(uniqueValuesRef.current));
    setSearchText("");
    props.filterChangedCallback();
  };

  // ── Checkbox helpers ─────────────────────────────────────────────────────

  const visibleValues = uniqueValues.filter((val) => {
    if (searchText && !val.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (cond1.value !== "" || cond2.value !== "") {
      const cellVal = val === DISPLAY_BLANK ? "" : val;
      if (!matchesTextFilter(cellVal, cond1, cond2, logic)) return false;
    }
    return true;
  });

  const isAllVisibleSelected =
    visibleValues.length > 0 && visibleValues.every((v) => selectedValues.has(v));
  const isSomeVisibleSelected =
    !isAllVisibleSelected && visibleValues.some((v) => selectedValues.has(v));

  const handleToggleAll = () => {
    const next = new Set(selectedValues);
    if (isAllVisibleSelected) visibleValues.forEach((v) => next.delete(v));
    else visibleValues.forEach((v) => next.add(v));
    setSelectedValues(next);
  };

  const handleToggleValue = (val: string) => {
    const next = new Set(selectedValues);
    if (next.has(val)) next.delete(val); else next.add(val);
    setSelectedValues(next);
  };

  const showSecondCond = cond1.value !== "";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", width: 260, fontFamily: "inherit", maxHeight: 520 }}>
      <div style={{ padding: 10, overflowY: "auto", flex: 1 }}>
        {/* ── 텍스트 필터 ── */}
        <div style={{ marginBottom: 8 }}>
          <div style={sectionLabel}>텍스트 필터</div>

          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 5 }}>
            <select
              value={cond1.op}
              onChange={(e) => setCond1((c) => ({ ...c, op: e.target.value as Operator }))}
              style={selectStyle}
            >
              {(Object.keys(OP_LABELS) as Operator[]).map((op) => (
                <option key={op} value={op}>{OP_LABELS[op]}</option>
              ))}
            </select>
            <input
              type="text"
              value={cond1.value}
              autoFocus
              placeholder="값 입력..."
              onChange={(e) => setCond1((c) => ({ ...c, value: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
              style={inputStyle}
            />
          </div>

          {showSecondCond && (
            <>
              <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
                {(["AND", "OR"] as Logic[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLogic(l)}
                    style={{
                      flex: 1, padding: "3px 0", fontSize: 11, fontWeight: 700,
                      border: "1px solid", borderRadius: 4, cursor: "pointer",
                      borderColor: logic === l ? "#3b82f6" : "#d1d5db",
                      backgroundColor: logic === l ? "#eff6ff" : "#f9fafb",
                      color: logic === l ? "#2563eb" : "#6b7280",
                      fontFamily: "inherit",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <select
                  value={cond2.op}
                  onChange={(e) => setCond2((c) => ({ ...c, op: e.target.value as Operator }))}
                  style={selectStyle}
                >
                  {(Object.keys(OP_LABELS) as Operator[]).map((op) => (
                    <option key={op} value={op}>{OP_LABELS[op]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={cond2.value}
                  placeholder="값 입력..."
                  onChange={(e) => setCond2((c) => ({ ...c, value: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
                  style={inputStyle}
                />
              </div>
            </>
          )}
        </div>

        {/* ── 값 필터 ── */}
        {!tooMany && (
          <>
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "8px 0" }} />
            <div style={sectionLabel}>값 필터</div>

            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="목록 검색..."
              style={{ ...inputStyle, marginBottom: 5, backgroundColor: "#f9fafb", border: "1px solid #e5e7eb" }}
            />

            <label
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "4px 2px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", borderBottom: "1px solid #e5e7eb",
                marginBottom: 4, color: "#374151",
              }}
            >
              <input
                type="checkbox"
                checked={isAllVisibleSelected}
                ref={(el) => { if (el) el.indeterminate = isSomeVisibleSelected; }}
                onChange={handleToggleAll}
                style={{ cursor: "pointer", accentColor: "#3b82f6" }}
              />
              (모두 선택)
              {selectedValues.size < uniqueValues.length && (
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, marginLeft: "auto" }}>
                  {selectedValues.size}/{uniqueValues.length}
                </span>
              )}
            </label>

            <div style={{ maxHeight: 190, overflowY: "auto" }}>
              {visibleValues.length === 0 ? (
                <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
                  일치하는 값 없음
                </div>
              ) : (
                visibleValues.map((val) => (
                  <label
                    key={val}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "3px 2px", fontSize: 12, cursor: "pointer",
                      color: val === DISPLAY_BLANK ? "#9ca3af" : "#374151",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedValues.has(val)}
                      onChange={() => handleToggleValue(val)}
                      style={{ cursor: "pointer", accentColor: "#3b82f6", flexShrink: 0 }}
                    />
                    <span
                      style={{
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontStyle: val === DISPLAY_BLANK ? "italic" : "normal",
                      }}
                      title={val}
                    >
                      {val}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Footer buttons ── */}
      <div
        style={{
          display: "flex", gap: 6, padding: "8px 10px",
          borderTop: "1px solid #e5e7eb", flexShrink: 0, backgroundColor: "#f9fafb",
        }}
      >
        <button
          onClick={handleClear}
          style={{
            flex: 1, padding: "5px 0", fontSize: 12, fontWeight: 600,
            border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
            backgroundColor: "#fff", color: "#6b7280", fontFamily: "inherit",
          }}
        >
          필터 초기화
        </button>
        <button
          onClick={handleApply}
          style={{
            flex: 1, padding: "5px 0", fontSize: 12, fontWeight: 600,
            border: "1px solid #3b82f6", borderRadius: 4, cursor: "pointer",
            backgroundColor: "#3b82f6", color: "#fff", fontFamily: "inherit",
          }}
        >
          필터 적용
        </button>
      </div>
    </div>
  );
});

export default ExcelStyleFilter;
