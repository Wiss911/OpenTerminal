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
      <polyline points={pts} fill="none" stroke={upTrend ? "#00c853" : "#ff3d3d"} strokeWidth={1} />
    </svg>
  );
}

export default function CryptoWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [source, setSource] = useState<"spot" | "hyperliquid">("spot");
  const [dex, setDex] = useState("");
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
          <tr><th>#</th><th>Asset</th><th>{source === "hyperliquid" ? "Mark Price" : "Price"}</th><th>24h%</th><th>{source === "hyperliquid" ? "—" : "MCap"}</th><th>Vol 24h</th><th>{source === "hyperliquid" ? "" : "7d"}</th></tr>
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
