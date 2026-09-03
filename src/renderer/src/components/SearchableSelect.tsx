import React, { useState, useLayoutEffect, useEffect, useMemo, useRef, useCallback } from "react";
import ReactDOM from "react-dom";

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
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({ position: "fixed" });

  const filtered = useMemo(
    () => options.filter(o => (o.label || "").toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const selectedLabel = options.find(o => o.value === value)?.label || "";

  // Recalculate position every time the dropdown opens or the window resizes
  const recalcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropHeight = Math.min(300, spaceBelow - 8);

    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      maxHeight: dropHeight,
    });
  }, []);

  // Measure before paint so the dropdown appears immediately in the right spot
  useLayoutEffect(() => {
    if (!open) return;
    recalcPosition();
    // Focus search input without triggering scroll
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
  }, [open, recalcPosition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => recalcPosition();
    const onResize = () => recalcPosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, recalcPosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const dropdown = open ? ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      style={{
        ...dropdownStyle,
        background: "var(--surface-container)",
        border: "1px solid var(--outline-variant)",
        borderRadius: 10,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        onClick={e => e.stopPropagation()}
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
          flexShrink: 0,
        }}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        <div
          onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
          style={{
            padding: "10px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: value === "" ? 700 : 400,
            color: value === "" ? "var(--primary)" : "var(--on-surface)",
            background: value === "" ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
            borderBottom: "1px solid var(--outline-variant)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          onMouseEnter={e => { if (value !== "") e.currentTarget.style.background = "var(--surface-container-high)"; }}
          onMouseLeave={e => { if (value !== "") e.currentTarget.style.background = "transparent"; }}
        >
          {/* <span className="material-symbols" style={{ fontSize: 16 }}>all_inclusive</span> */}
          None
          {value === "" && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto" }}>check</span>}
        </div>
        {filtered.map(o => (
          <div
            key={o.value}
            onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
            style={{
              padding: "10px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: value === o.value ? 700 : 400,
              color: value === o.value ? "var(--primary)" : "var(--on-surface)",
              background: value === o.value ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
              borderBottom: "1px solid var(--outline-variant)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
            onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = "var(--surface-container-high)"; }}
            onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
            {value === o.value && <span className="material-symbols" style={{ fontSize: 14, marginLeft: "auto" }}>check</span>}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "10px 14px", color: "var(--on-surface-variant)", fontSize: 13, fontStyle: "italic" }}>
            No results found
          </div>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={triggerRef} style={{ position: "relative", width: "100%" }}>
      <div
        onClick={(e) => { e.preventDefault(); if (!disabled) { setOpen(o => !o); setSearch(""); } }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          padding: "6px 12px",
          border: "1px solid var(--outline-variant)",
          borderRadius: 8,
          background: disabled ? "var(--surface-container-low)" : "var(--surface-container-low)",
          cursor: disabled ? "not-allowed" : "pointer",
          minHeight: 36,
          fontSize: 13,
          color: value ? "var(--on-surface)" : "var(--on-surface-variant)",
          boxSizing: "border-box",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || placeholder || "Select..."}
        </span>
        <span className="material-symbols" style={{ fontSize: 14, flexShrink: 0, color: "var(--on-surface-variant)" }}>
          expand_more
        </span>
      </div>
      {dropdown}
    </div>
  );
}
