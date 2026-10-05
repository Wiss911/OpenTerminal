"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import Flash from "../Flash";
import { useTerminal } from "../../store/terminal";
import { ColumnSettings, useVisibleColumns, type TableColumn } from "./ColumnSettings";

type CryptoRow = {
  id: string; symbol: string; name: string; price: number;
  changePercent24h: number | null; marketCap: number | null; volume24h: number | null;
  rank: number | null; sparkline: number[];
};
type GlobalStats = { totalMarketCap: number; btcDominance: number; ethDominance: number };
type PerpDex = { id: string; label: string };
const BINANCE_INTRADAY = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "LTC", "MATIC"]);
const COLUMNS: TableColumn[] = [
  { id: "rank", label: "Rank" }, { id: "asset", label: "Asset" }, { id: "price", label: "Price" },
  { id: "change", label: "24h change" }, { id: "period", label: "Selected change" }, { id: "30m", label: "30m change" },
  { id: "4h", label: "4h change" }, { id: "marketCap", label: "Market cap" }, { id: "volume", label: "24h USD volume" }, { id: "sparkline", label: "7d chart" },
];

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 60;
  const h = 16;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`)
    .join(" ");
  const upTrend = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={upTrend ? "var(--up)" : "var(--down)"} strokeWidth={1} />
    </svg>
  );
}

export default function CryptoWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [source, setSource] = useState<"spot" | "binance-futures" | "hyperliquid">("spot");
  const [dex, setDex] = useState("");
  const [period, setPeriod] = useState<"5m" | "15m" | "1h">("15m");
  const columnPrefs = useVisibleColumns("openterminal:columns:crypto", COLUMNS, COLUMNS.map((column) => column.id));
  const shownColumns = COLUMNS.filter((column) => columnPrefs.visible.includes(column.id));
  const { data = [], error } = useQuery({
    queryKey: source === "spot" ? ["crypto"] : source === "binance-futures" ? ["binance-futures-markets"] : ["hyperliquid-markets", dex],
    queryFn: () => apiGet<CryptoRow[]>(source === "spot"
      ? "/api/crypto"
      : source === "binance-futures" ? "/api/crypto/binance-futures"
      : `/api/crypto/hyperliquid${dex ? `?dex=${encodeURIComponent(dex)}` : ""}`),
    refetchInterval: source === "spot" ? 1_000 : 30_000,
  });
  const { data: dexes = [] } = useQuery({
    queryKey: ["hyperliquid-dexes"],
    queryFn: () => apiGet<PerpDex[]>("/api/crypto/hyperliquid/dexes"),
    enabled: source === "hyperliquid",
    staleTime: 300_000,
  });
  const { data: global } = useQuery({
    queryKey: ["crypto-global"],
    queryFn: () => apiGet<GlobalStats>("/api/crypto/global"),
    refetchInterval: 30_000,
    enabled: source === "spot",
  });
  const changeSymbols = data
    .filter((c) => source !== "spot" || BINANCE_INTRADAY.has(c.symbol))
    .slice(0, 40)
    .map((c) => source === "hyperliquid" ? `HL:${c.symbol}` : source === "binance-futures" ? c.symbol : c.symbol)
    .join(",");
  const { data: shortChanges = {} } = useQuery({
    queryKey: ["short-changes", changeSymbols],
    queryFn: () => apiGet<Record<string, Record<string, number | null>>>(`/api/changes?symbols=${encodeURIComponent(changeSymbols)}`),
    enabled: changeSymbols.length > 0,
    staleTime: 60_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;

  return (
    <div>
      <div className="flex gap-1 items-center px-2 py-1 border-b border-[var(--border)]">
        <button className={`term-btn ${source === "spot" ? "active" : ""}`} onClick={() => setSource("spot")}>Spot</button>
        <button className={`term-btn ${source === "binance-futures" ? "active" : ""}`} onClick={() => setSource("binance-futures")}>Binance Futures</button>
        <button className={`term-btn ${source === "hyperliquid" ? "active" : ""}`} onClick={() => setSource("hyperliquid")}>Hyperliquid Perps</button>
        {source === "hyperliquid" && (
          <select className="ml-auto bg-black text-[var(--text)] border border-[var(--border)] px-1 py-0.5" value={dex} onChange={(e) => setDex(e.target.value)}>
            {dexes.map((item) => <option key={item.id || "main"} value={item.id}>{item.label}</option>)}
          </select>
        )}
        <select aria-label="Crypto short change period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="5m">Δ 5m</option><option value="15m">Δ 15m</option><option value="1h">Δ 1h</option>
        </select>
        <ColumnSettings columns={COLUMNS} visible={columnPrefs.visible} onToggle={columnPrefs.toggle} onReset={columnPrefs.reset} />
      </div>
      {source === "spot" && global && (
        <div className="flex gap-4 px-2 py-1 border-b border-[var(--border)] dim">
          <span>Total MCap <span className="text-[var(--text)]">{fmtBig(global.totalMarketCap)}</span></span>
          <span>BTC.D <span className="amber">{fmt(global.btcDominance, 1)}%</span></span>
          <span>ETH.D <span className="amber">{fmt(global.ethDominance, 1)}%</span></span>
        </div>
      )}
      <table className="data-table">
        <thead><tr>{shownColumns.map(({ id, label }) => <th key={id}>{id === "price" && source === "hyperliquid" ? "Mark Price" : id === "period" ? period : id === "marketCap" && source !== "spot" ? "—" : id === "sparkline" && source !== "spot" ? "" : label}</th>)}</tr></thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} onClick={() => setActiveSymbol(source === "hyperliquid" ? `HL:${c.symbol}` : source === "binance-futures" ? c.symbol : c.symbol)}>
              {shownColumns.map(({ id }) => {
                const symbol = source === "hyperliquid" ? `HL:${c.symbol}` : c.symbol;
                const periodKey = id === "period" ? period : id;
                const change = ["period", "30m", "4h"].includes(id) ? shortChanges[symbol]?.[periodKey] : null;
                if (id === "rank") return <td key={id} className="dim">{c.rank ?? (source === "spot" ? "—" : "PERP")}</td>;
                if (id === "asset") return <td key={id} className="!text-left"><span className="font-bold">{c.symbol}</span> <span className="dim">{c.name}</span></td>;
                if (id === "price") return <td key={id}><Flash value={c.price}>{c.price >= 1 ? fmt(c.price) : c.price.toPrecision(4)}</Flash></td>;
                if (id === "change") return <td key={id} className={pctClass(c.changePercent24h)}><Flash value={c.changePercent24h}>{fmt(c.changePercent24h)}%</Flash></td>;
                if (["period", "30m", "4h"].includes(id)) return <td key={id} className={pctClass(change)} title={source === "spot" && !BINANCE_INTRADAY.has(c.symbol) ? "Intraday history is not currently available for this spot provider." : undefined}><Flash value={change}>{change == null ? "—" : `${fmt(change)}%`}</Flash></td>;
                if (id === "marketCap") return <td key={id}>{source === "spot" ? fmtBig(c.marketCap) : "—"}</td>;
                if (id === "volume") return <td key={id}>{fmtBig(c.volume24h)}</td>;
                return <td key={id}>{source === "spot" && <Sparkline data={c.sparkline.filter((_, i) => i % 4 === 0)} />}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
