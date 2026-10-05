"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import { ColumnSettings, useVisibleColumns, type TableColumn } from "./ColumnSettings";

type Row = {
  symbol: string; name: string; price: number | null;
  changePercent: number | null; volume: number | null; marketCap: number | null;
  sector: string;
};
type Provider = "tradingview" | "binance-futures" | "hyperliquid-perps" | "hyperliquid-xyz" | "hyperliquid-all";
const COLUMNS: TableColumn[] = [
  { id: "symbol", label: "Symbol" }, { id: "name", label: "Name" }, { id: "sector", label: "Provider / sector" },
  { id: "price", label: "Last" }, { id: "change", label: "Change %" }, { id: "volume", label: "Volume" },
  { id: "intraday", label: "Selected interval" }, { id: "30m", label: "30m" }, { id: "4h", label: "4h" }, { id: "marketCap", label: "Market cap" },
];

export default function ScreenerWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [market, setMarket] = useState<"us" | "eu">("us");
  const [provider, setProvider] = useState<Provider>("tradingview");
  const [sector, setSector] = useState("");
  const [changeMin, setChangeMin] = useState("");
  const [marketCapMinB, setMarketCapMinB] = useState("");
  const [volumeMinM, setVolumeMinM] = useState("");
  const [period, setPeriod] = useState<"5m" | "15m" | "1h">("15m");
  const [periodMin, setPeriodMin] = useState("");
  const [periodMax, setPeriodMax] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState("marketCap");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const columnPrefs = useVisibleColumns("openterminal:columns:screener", COLUMNS, COLUMNS.map((c) => c.id));

  const { data: sectors = [] } = useQuery({
    queryKey: ["sectors", market],
    queryFn: () => apiGet<string[]>(`/api/sectors?market=${market}`),
    staleTime: 600_000,
  });

  const params = new URLSearchParams();
  params.set("provider", provider);
  params.set("market", market);
  if (sector && provider === "tradingview") params.set("sector", sector);
  if (changeMin) params.set("changeMin", changeMin);
  if (marketCapMinB && provider === "tradingview") params.set("marketCapMin", String(Number(marketCapMinB) * 1e9));
  if (volumeMinM) params.set("volumeMin", String(Number(volumeMinM) * 1e6));
  params.set("sort", sort);
  params.set("dir", dir);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["screener", params.toString()],
    queryFn: () => apiGet<Row[]>(`/api/screener?${params}`),
    refetchInterval: 20_000,
  });

  const pageCount = Math.max(1, Math.ceil(data.length / 40));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = data.slice(safePage * 40, (safePage + 1) * 40);
  const changeSymbols = pageRows.map((row) => row.symbol).join(",");
  const { data: shortChanges = {} } = useQuery({
    queryKey: ["short-changes", changeSymbols],
    queryFn: () => apiGet<Record<string, Record<string, number | null>>>(`/api/changes?symbols=${encodeURIComponent(changeSymbols)}`),
    enabled: pageRows.length > 0,
    staleTime: 60_000,
  });
  const visibleRows = pageRows.filter((row) => {
    const change = shortChanges[row.symbol]?.[period];
    if (periodMin && (change === null || change === undefined || change < Number(periodMin))) return false;
    if (periodMax && (change === null || change === undefined || change > Number(periodMax))) return false;
    return true;
  });

  const th = (key: string, label: string) => (
    <th
      key={key}
      onClick={() => {
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
        else setSort(key);
      }}
      className={sort === key ? "!text-[var(--amber)]" : ""}
    >
      {label} {sort === key ? (dir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex gap-2 p-1 flex-wrap items-center">
        <select aria-label="Data provider" value={provider} onChange={(e) => {
          const next = e.target.value as Provider;
          setProvider(next);
          setPage(0);
          setSector("");
          if (next !== "tradingview") setSort("volume");
          else setSort("marketCap");
        }}>
          <option value="tradingview">TradingView</option>
          <option value="binance-futures">Binance USDⓈ-M Perpetuals</option>
          <option value="hyperliquid-perps">Hyperliquid Perpetuals</option>
          <option value="hyperliquid-xyz">Hyperliquid XYZ</option>
          <option value="hyperliquid-all">Hyperliquid All</option>
        </select>
        {provider === "tradingview" ? <>
          <div className="flex gap-1">
            {(["us", "eu"] as const).map((m) => (
              <button key={m} className={`term-btn ${market === m ? "active" : ""}`} onClick={() => setMarket(m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </> : null}
        <input className="w-20" placeholder="Chg% min" value={changeMin} onChange={(e) => setChangeMin(e.target.value)} />
        {provider === "tradingview" && <input className="w-24" placeholder="MCap min ($B)" value={marketCapMinB} onChange={(e) => setMarketCapMinB(e.target.value)} />}
        <input className="w-24" placeholder="Vol min (M)" value={volumeMinM} onChange={(e) => setVolumeMinM(e.target.value)} />
        <select aria-label="Short change filter period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          <option value="5m">Δ 5m</option><option value="15m">Δ 15m</option><option value="1h">Δ 1h</option>
        </select>
        <input aria-label={`Minimum ${period} price change`} className="w-24" placeholder="Δ min %" value={periodMin} onChange={(e) => setPeriodMin(e.target.value)} />
        <input aria-label={`Maximum ${period} price change`} className="w-24" placeholder="Δ max %" value={periodMax} onChange={(e) => setPeriodMax(e.target.value)} />
        <span className="dim ml-auto">{isLoading ? "…" : `${data.length} results`}</span>
        <ColumnSettings columns={COLUMNS} visible={columnPrefs.visible} onToggle={columnPrefs.toggle} onReset={columnPrefs.reset} />
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <table className="data-table">
        <thead>
          <tr>
            {columnPrefs.visible.map((id) => id === "symbol" ? th("symbol", "Sym")
              : id === "name" ? <th key={id}>Name</th>
              : id === "sector" ? <th key={id}>Provider / sector</th>
              : id === "price" ? th("price", "Last")
              : id === "change" ? th("changePercent", "Chg%")
              : id === "volume" ? <th key={id} title={provider === "tradingview" ? "TradingView volume is traded shares/units, not USD." : "Volume is 24-hour traded notional in USD/USDT."} onClick={() => { if (sort === "volume") setDir(dir === "asc" ? "desc" : "asc"); else setSort("volume"); }}>{provider === "tradingview" ? "Vol (units)" : "Vol USD"} {sort === "volume" ? (dir === "desc" ? "▼" : "▲") : ""}</th>
              : id === "intraday" ? <th key={id} title="Percent move over selected short interval">{period}</th>
              : id === "30m" ? <th key={id}>30m</th>
              : id === "4h" ? <th key={id}>4h</th>
              : th("marketCap", "MCap"))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              {columnPrefs.visible.map((id) => id === "symbol" ? <td key={id} className="font-bold">{q.symbol}</td>
              : id === "name" ? <td key={id} className="!text-left max-w-40 truncate">{q.name}</td>
              : id === "sector" ? <td key={id} className="!text-left dim">{q.sector}</td>
              : id === "price" ? <td key={id}><Flash value={q.price}>{fmt(q.price)}</Flash></td>
              : id === "change" ? <td key={id} className={pctClass(q.changePercent)}>
                <Flash value={q.changePercent}>{fmt(q.changePercent)}%</Flash>
              </td>
              : id === "volume" ? <td key={id}>{fmtBig(q.volume)}</td>
              : id === "intraday" || id === "30m" || id === "4h" ? (() => {
                const key = id === "intraday" ? period : id;
                const change = shortChanges[q.symbol]?.[key];
                return <td key={id} className={pctClass(change)}><Flash value={change}>{change == null ? "—" : `${fmt(change)}%`}</Flash></td>;
              })()
              : <td key={id}>{fmtBig(q.marketCap)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between p-1 dim">
        <span>Intraday filter applies to this page; candle data is cached for 60 seconds.</span>
        <span className="flex gap-2 items-center">
          <button className="term-btn" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
          {safePage + 1} / {pageCount}
          <button className="term-btn" disabled={(safePage + 1) * 40 >= data.length} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </span>
      </div>
    </div>
  );
}
