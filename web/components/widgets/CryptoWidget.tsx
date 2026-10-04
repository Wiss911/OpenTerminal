"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import Flash from "../Flash";
import { useTerminal } from "../../store/terminal";

type CryptoRow = {
  id: string; symbol: string; name: string; price: number;
  changePercent24h: number | null; marketCap: number | null; volume24h: number | null;
  rank: number | null; sparkline: number[];
};
type GlobalStats = { totalMarketCap: number; btcDominance: number; ethDominance: number };
type PerpDex = { id: string; label: string };
const BINANCE_INTRADAY = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "LTC", "MATIC"]);

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
  const [source, setSource] = useState<"spot" | "hyperliquid">("spot");
  const [dex, setDex] = useState("");
  const [period, setPeriod] = useState<"5m" | "15m" | "1h">("15m");
  const { data = [], error } = useQuery({
    queryKey: source === "spot" ? ["crypto"] : ["hyperliquid-markets", dex],
    queryFn: () => apiGet<CryptoRow[]>(source === "spot"
      ? "/api/crypto"
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
    .filter((c) => source === "hyperliquid" || BINANCE_INTRADAY.has(c.symbol))
    .slice(0, 40)
    .map((c) => source === "hyperliquid" ? `HL:${c.symbol}` : c.symbol)
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
        <button className={`term-btn ${source === "hyperliquid" ? "active" : ""}`} onClick={() => setSource("hyperliquid")}>Hyperliquid Perps</button>
        {source === "hyperliquid" && (
          <select className="ml-auto bg-black text-[var(--text)] border border-[var(--border)] px-1 py-0.5" value={dex} onChange={(e) => setDex(e.target.value)}>
            {dexes.map((item) => <option key={item.id || "main"} value={item.id}>{item.label}</option>)}
          </select>
        )}
        <select aria-label="Crypto short change period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="5m">Δ 5m</option><option value="15m">Δ 15m</option><option value="1h">Δ 1h</option>
        </select>
      </div>
      {source === "spot" && global && (
        <div className="flex gap-4 px-2 py-1 border-b border-[var(--border)] dim">
          <span>Total MCap <span className="text-[var(--text)]">{fmtBig(global.totalMarketCap)}</span></span>
          <span>BTC.D <span className="amber">{fmt(global.btcDominance, 1)}%</span></span>
          <span>ETH.D <span className="amber">{fmt(global.ethDominance, 1)}%</span></span>
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Asset</th><th>{source === "hyperliquid" ? "Mark Price" : "Price"}</th><th>24h%</th><th>{period}</th><th>30m</th><th>4h</th><th>{source === "hyperliquid" ? "—" : "MCap"}</th><th>Vol 24h USD*</th><th>{source === "hyperliquid" ? "" : "7d"}</th></tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} onClick={() => setActiveSymbol(source === "hyperliquid" ? `HL:${c.symbol}` : c.symbol)}>
              <td className="dim">{c.rank ?? (source === "hyperliquid" ? "PERP" : "—")}</td>
              <td className="!text-left"><span className="font-bold">{c.symbol}</span> <span className="dim">{c.name}</span></td>
              <td><Flash value={c.price}>{c.price >= 1 ? fmt(c.price) : c.price.toPrecision(4)}</Flash></td>
              <td className={pctClass(c.changePercent24h)}>
                <Flash value={c.changePercent24h}>{fmt(c.changePercent24h)}%</Flash>
              </td>
              {[period, "30m", "4h"].map((key) => {
                const symbol = source === "hyperliquid" ? `HL:${c.symbol}` : c.symbol;
                const change = shortChanges[symbol]?.[key];
                return <td key={key} className={pctClass(change)} title={source === "spot" && !BINANCE_INTRADAY.has(c.symbol) ? "Intraday history is not currently available for this spot provider." : undefined}><Flash value={change}>{change == null ? "—" : `${fmt(change)}%`}</Flash></td>;
              })}
              <td>{source === "hyperliquid" ? "—" : fmtBig(c.marketCap)}</td>
              <td>{fmtBig(c.volume24h)}</td>
              <td>{source === "spot" && <Sparkline data={c.sparkline.filter((_, i) => i % 4 === 0)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
