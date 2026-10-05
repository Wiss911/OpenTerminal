"use client";

import { useEffect, useState } from "react";

export type TableColumn = { id: string; label: string };

export function useVisibleColumns(storageKey: string, columns: TableColumn[], defaults: string[]) {
  const [visible, setVisible] = useState<string[]>(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((id): id is string => typeof id === "string" && columns.some((c) => c.id === id));
          setVisible(valid.length ? valid : defaults);
        }
      }
    } catch { /* Use the default columns if browser storage is unavailable. */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (ready) try { localStorage.setItem(storageKey, JSON.stringify(visible)); } catch { /* Keep the current choice for this session. */ }
  }, [ready, storageKey, visible]);
  const toggle = (id: string) => setVisible((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return { visible, toggle, reset: () => setVisible(defaults) };
}

export function ColumnSettings({ columns, visible, onToggle, onReset }: {
  columns: TableColumn[]; visible: string[]; onToggle: (id: string) => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="relative ml-auto">
    <button className={`term-btn ${open ? "active" : ""}`} aria-label="Configure columns" title="Configure columns" onClick={() => setOpen((v) => !v)}>☷</button>
    {open && <div className="absolute right-0 top-full z-30 min-w-44 max-h-64 overflow-auto border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg text-xs">
      <div className="flex justify-between items-center mb-1"><strong>Columns</strong><button className="dim" onClick={onReset}>Reset</button></div>
      {columns.map((column) => <label key={column.id} className="flex gap-2 items-center py-1 whitespace-nowrap">
        <input type="checkbox" checked={visible.includes(column.id)} onChange={() => onToggle(column.id)} />{column.label}
      </label>)}
    </div>}
  </div>;
}
