import React, { useState, useEffect, useMemo, useRef } from "react";

export interface MultiSearchableSelectProps {
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MultiSearchableSelect({
  options,
  values,
  onChange,
  placeholder,
  disabled
}: MultiSearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => options.filter(o => (o.label || "").toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const selectedLabels = values.map(v => options.find(o => o.value === v)?.label || v);
  const visibleSelectedLabels = selectedLabels.slice(0, 2);
  const hiddenSelectedCount = Math.max(0, selectedLabels.length - visibleSelectedLabels.length);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleValue(val: string) {
    if (values.includes(val)) {
      onChange(values.filter(v => v !== val));
    } else {
      onChange([...values, val]);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <div
        onClick={() => { if (!disabled) { setOpen(!open); setSearch(""); } }}
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 8px",
          minHeight: 36,
          border: "1px solid var(--outline-variant)",
          borderRadius: 8,
          background: "var(--surface-container-low)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 13,
          boxSizing: "border-box",
        }}
      >
        {values.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0, alignItems: "center" }}>
            {visibleSelectedLabels.map((label, index) => {
              const value = values[index];
              return (
                <span
                  key={value}
                  onClick={(e) => { e.stopPropagation(); toggleValue(value); }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px",
                    background: "var(--primary-container)",
                    borderRadius: 999,
                    fontSize: 12,
                    color: "var(--on-primary-container)",
                    cursor: "pointer",
                    maxWidth: "100%",
                    minWidth: 0,
                    lineHeight: 1.2,
                    flexShrink: 1,
                  }}
                  title={label}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: "100%" }}>{label}</span>
                  <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>&times;</span>
                </span>
              );
            })}
            {hiddenSelectedCount > 0 && (
              <span style={{ fontSize: 12, color: "var(--on-surface-variant)", padding: "4px 6px" }}>
                +{hiddenSelectedCount} more
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "var(--on-surface-variant)", fontSize: 14 }}>
            {placeholder || "Select..."}
          </span>
        )}
        <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto", flexShrink: 0, color: "var(--on-surface-variant)" }}>expand_more</span>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "var(--surface-container)",
            border: "1px solid var(--outline-variant)",
            borderRadius: 10,
            marginTop: 6,
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            maxHeight: 360,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: "8px 14px",
              border: "none",
              borderBottom: "1px solid var(--outline-variant)",
              outline: "none",
              fontSize: 13,
              width: "100%",
              boxSizing: "border-box",
              background: "var(--surface-container)",
              color: "var(--on-surface)",
            }}
          />
          <div style={{ overflowY: "auto", maxHeight: 280 }}>
            {filtered.map((o) => {
              const selected = values.includes(o.value);
              return (
                <div
                  key={o.value}
                  onClick={() => toggleValue(o.value)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px minmax(0, 1fr) 16px",
                    alignItems: "center",
                    columnGap: 8,
                    padding: "10px 14px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: selected ? "var(--primary)" : "var(--on-surface)",
                    fontWeight: selected ? 700 : 400,
                    background: selected ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                    borderBottom: "1px solid var(--outline-variant)",
                    textAlign: "left",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-container-high)"; }}
                  onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {}}
                    style={{ cursor: "pointer", margin: 0, width: 16, height: 16, justifySelf: "center", accentColor: "var(--primary)" }}
                  />
                  <div style={{ minWidth: 0, overflow: "hidden" }}>
                    <div style={{ lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "inherit" }}>{o.label}</div>
                  </div>
                  {selected && <span className="material-symbols" style={{ fontSize: 14, justifySelf: "center", color: "var(--primary)" }}>check</span>}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "10px 14px", color: "var(--on-surface-variant)", fontSize: 13, fontStyle: "italic" }}>
                No results found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
