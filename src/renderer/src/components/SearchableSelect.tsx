import React, { useState, useEffect, useMemo, useRef } from "react";

export interface SearchableSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => options.filter(o => (o.label || "").toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const selectedLabel = options.find(o => o.value === value)?.label || "";

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

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <div
        onClick={() => { if (!disabled) { setOpen(!open); setSearch(""); } }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          border: "1px solid var(--outline-variant)",
          borderRadius: 6,
          background: disabled ? "var(--surface-container-low)" : "var(--surface)",
          cursor: disabled ? "not-allowed" : "pointer",
          minHeight: 36,
          fontSize: 14,
          color: value ? "var(--on-surface)" : "var(--on-surface-variant)",
          boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || placeholder || "Select..."}
        </span>
        <span className="material-symbols" style={{ fontSize: 18, flexShrink: 0 }}>arrow_drop_down</span>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--surface)",
            border: "1px solid var(--outline-variant)",
            borderRadius: 6,
            marginTop: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: 300,
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
              padding: "8px 12px",
              border: "none",
              borderBottom: "1px solid var(--outline-variant)",
              outline: "none",
              fontSize: 14,
              width: "100%",
              boxSizing: "border-box",
              background: "var(--surface)",
            }}
          />
          <div style={{ overflowY: "auto", maxHeight: 240 }}>
            <div
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 14,
                color: value === "" ? "var(--primary)" : "var(--on-surface-variant)",
                background: value === "" ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-container-high)"; }}
              onMouseLeave={(e) => { if (value !== "") e.currentTarget.style.background = "transparent"; }}
            >
              -- Clear --
            </div>
            {filtered.map((o) => (
              <div
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 14,
                  color: value === o.value ? "var(--primary)" : "var(--on-surface)",
                  background: value === o.value ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => { if (value !== o.value) e.currentTarget.style.background = "var(--surface-container-high)"; }}
                onMouseLeave={(e) => { if (value !== o.value) e.currentTarget.style.background = "transparent"; }}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "8px 12px", color: "var(--on-surface-variant)", fontSize: 14, fontStyle: "italic" }}>
                No results found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
