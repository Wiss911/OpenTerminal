"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

export default function WatchlistWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [input, setInput] = useState("");
  const [period, setPeriod] = useState<"5m" | "15m" | "1h">("15m");

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
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Sym</th><th>Last</th><th>24h%</th><th>{period}</th><th>30m</th><th>4h</th><th title="Crypto volumes are USD/USDT notional; stock volumes are shares">Vol 24h*</th><th></th></tr>
        </thead>
        <tbody>
          {watchlist.map((sym) => {
            const q = data.find((d) => d.symbol === sym);
            return (
              <tr key={sym} onClick={() => setActiveSymbol(sym)}>
                <td className="font-bold">{sym}</td>
                <td><Flash value={q?.price}>{fmt(q?.price)}</Flash></td>
                <td className={pctClass(q?.changePercent)}>
                  <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
                </td>
                {[period, "30m", "4h"].map((key) => {
                  const change = shortChanges[sym]?.[key];
                  return <td key={key} className={pctClass(change)}><Flash value={change}>{change == null ? "—" : `${fmt(change)}%`}</Flash></td>;
                })}
                <td title={q?.source === "hyperliquid" || q?.source === "binance" ? "USD/USDT quote notional" : "Trading volume in shares/units"}>{fmtBig(q?.volume)}</td>
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
