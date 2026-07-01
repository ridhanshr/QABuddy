import React, { useState, useEffect, useMemo, useRef } from "react";
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
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const filtered = useMemo(
    () => options.filter(o => (o.label || "").toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  const selectedLabel = options.find(o => o.value === value)?.label || "";

  // Recalculate position every time the dropdown opens or the window resizes
  const recalcPosition = () => {
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
  };

  useEffect(() => {
    if (open) recalcPosition();
  }, [open]);

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
  }, [open]);

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
        background: "var(--surface)",
        border: "1px solid var(--outline-variant)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
        onClick={e => e.stopPropagation()}
        style={{
          padding: "8px 12px",
          border: "none",
          borderBottom: "1px solid var(--outline-variant)",
          outline: "none",
          fontSize: 14,
          width: "100%",
          boxSizing: "border-box",
          background: "var(--surface)",
          color: "var(--on-surface)",
          flexShrink: 0,
        }}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        <div
          onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            fontSize: 14,
            color: value === "" ? "var(--primary)" : "var(--on-surface-variant)",
            background: value === "" ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-container-high)"; }}
          onMouseLeave={e => { if (value !== "") e.currentTarget.style.background = "transparent"; }}
        >
          -- Clear --
        </div>
        {filtered.map(o => (
          <div
            key={o.value}
            onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
            style={{
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: 14,
              color: value === o.value ? "var(--primary)" : "var(--on-surface)",
              background: value === o.value ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
            }}
            onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = "var(--surface-container-high)"; }}
            onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = "transparent"; }}
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
    </div>,
    document.body
  ) : null;

  return (
    <div ref={triggerRef} style={{ position: "relative", width: "100%" }}>
      <div
        onClick={() => { if (!disabled) { setOpen(o => !o); setSearch(""); } }}
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
        <span className="material-symbols" style={{ fontSize: 18, flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
          arrow_drop_down
        </span>
      </div>
      {dropdown}
    </div>
  );
}
