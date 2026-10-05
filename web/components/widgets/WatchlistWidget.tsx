"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import { ColumnSettings, useVisibleColumns, type TableColumn } from "./ColumnSettings";

const COLUMNS: TableColumn[] = [
  { id: "symbol", label: "Symbol" }, { id: "name", label: "Name" }, { id: "price", label: "Last" },
  { id: "change", label: "24h %" }, { id: "short", label: "Selected interval" }, { id: "30m", label: "30m" },
  { id: "4h", label: "4h" }, { id: "volume", label: "Volume" },
];

export default function WatchlistWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [input, setInput] = useState("");
  const [period, setPeriod] = useState<"5m" | "15m" | "1h">("15m");
  const columnPrefs = useVisibleColumns("openterminal:columns:watchlist", COLUMNS, COLUMNS.map((c) => c.id));

  const { data = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${watchlist.join(",")}`),
    enabled: watchlist.length > 0,
    refetchInterval: 1_000,
  });
  const shortSymbols = watchlist.slice(0, 40).join(",");
  const { data: shortChanges = {} } = useQuery({
    queryKey: ["short-changes", shortSymbols],
    queryFn: () => apiGet<Record<string, Record<string, number | null>>>(`/api/changes?symbols=${encodeURIComponent(shortSymbols)}`),
    enabled: watchlist.length > 0,
    staleTime: 60_000,
  });

  return (
    <div>
      <form
        className="flex gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            addToWatchlist(input.trim());
            setInput("");
          }
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add ticker…"
          className="flex-1"
        />
        <button className="term-btn" type="submit">+</button>
      </form>
      <div className="flex items-center gap-1 px-2 pb-1 dim">
        <span>Short move</span>
        <select aria-label="Watchlist short change period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="5m">5 min</option><option value="15m">15 min</option><option value="1h">1 hour</option>
        </select>
        <ColumnSettings columns={COLUMNS} visible={columnPrefs.visible} onToggle={columnPrefs.toggle} onReset={columnPrefs.reset} />
      </div>
      <table className="data-table">
        <thead>
          <tr>{columnPrefs.visible.map((id) => <th key={id} title={id === "volume" ? "Crypto volume is USD/USDT notional; stock volume is shares or units" : undefined}>{id === "symbol" ? "Sym" : id === "name" ? "Name" : id === "price" ? "Last" : id === "change" ? "24h%" : id === "short" ? period : id === "volume" ? "Vol 24h*" : id}</th>)}<th></th></tr>
        </thead>
        <tbody>
          {watchlist.map((sym) => {
            const q = data.find((d) => d.symbol === sym);
            return (
              <tr key={sym} onClick={() => setActiveSymbol(sym)}>
                {columnPrefs.visible.map((id) => id === "symbol" ? <td key={id} className="font-bold">{sym}</td>
                : id === "name" ? <td key={id} className="!text-left">{q?.name ?? "—"}</td>
                : id === "price" ? <td key={id}><Flash value={q?.price}>{fmt(q?.price)}</Flash></td>
                : id === "change" ? <td key={id} className={pctClass(q?.changePercent)}>
                  <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
                </td>
                : id === "volume" ? <td key={id} title={q?.source === "hyperliquid" || q?.source.startsWith("binance") ? "USD/USDT quote notional" : "Trading volume in shares/units"}>{fmtBig(q?.volume)}</td>
                : (() => {
                  const key = id === "short" ? period : id;
                  const change = shortChanges[sym]?.[key];
                  return <td key={id} className={pctClass(change)}><Flash value={change}>{change == null ? "—" : `${fmt(change)}%`}</Flash></td>;
                })())}
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromWatchlist(sym);
                    }}
                    className="dim hover:text-[var(--down)]"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
